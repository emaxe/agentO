import { mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import type { WriteBackupFile } from './store.js';

/** Serialize preparation and restore; manifests reserve files between operations. */
export async function withConfigOperation<T>(operation: () => Promise<T>): Promise<T> {
  const directory = path.join(homedir(), '.agento', 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(directory, {
    stale: 10_000,
    update: 2_000,
    retries: { retries: 50, minTimeout: 250, maxTimeout: 250, factor: 1 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

/** Resolve existing parents too, since generated config files may not exist yet. */
export async function canonicalConfigPath(
  file: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  let current = path.resolve(file);
  const tail: string[] = [];
  for (;;) {
    try {
      current = path.join(await realpath(current), ...tail);
      return platform === 'win32' ? current.toLowerCase() : current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Must run under withConfigOperation, before publishing a new backup or writing configs. */
export async function assertConfigFilesAvailable(
  files: WriteBackupFile[],
  agentId: string,
): Promise<void> {
  const requested = new Set(
    await Promise.all(
      files.filter((file) => file.path).map((file) => canonicalConfigPath(file.path)),
    ),
  );
  const root = path.join(homedir(), '.agento', 'backups');
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.endsWith('.lock')) await visit(location);
      } else if (entry.name.endsWith('.bak.json')) {
        // Fail closed on malformed manifests rather than risking their original files.
        const manifest = JSON.parse(await readFile(location, 'utf8'));
        if (manifest?.version !== 2) {
          // Legacy backups have no file list: conservatively reserve this agent.
          if (path.relative(root, location).split(path.sep)[0] === agentId) {
            throw new Error(
              `Active backup already exists for ${agentId}: restore ${location} before launching again.`,
            );
          }
          continue;
        }
        if (!Array.isArray(manifest.files)) throw new Error(`Invalid backup manifest: ${location}`);
        for (const file of manifest.files) {
          if (typeof file?.path !== 'string')
            throw new Error(`Invalid backup manifest: ${location}`);
          if (
            (!file.path && manifest.agentId === agentId) ||
            (file.path && requested.has(await canonicalConfigPath(file.path)))
          ) {
            throw new Error(
              `Active backup already exists for ${manifest.agentId} (${manifest.scope}): shared config file ${file.path}. Run "agento restore -a ${manifest.agentId} -s ${manifest.scope}"${manifest.cwd ? ` in ${manifest.cwd}` : ''} before launching again. Backup: ${location}`,
            );
          }
        }
      }
    }
  }
  await visit(root);
}
