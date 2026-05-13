import { unlink } from 'node:fs/promises';
import type { AgentAdapter } from '../adapters/base.js';
import type { LaunchScope } from './schema.js';
import type { BackupManifest, BackupManifestFile } from './store.js';

function missingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
}

function firstBackupFile(manifest: BackupManifest): BackupManifestFile {
  const file = manifest.files[0];
  if (!file) {
    throw new Error(`Backup for ${manifest.agentId} (${manifest.scope}) has no files`);
  }
  return file;
}

/**
 * Restores the primary agent config file described by a backup manifest.
 * Kept for single-file callers and legacy backup compatibility.
 */
export async function restorePrimaryBackupFile(
  adapter: AgentAdapter,
  manifest: BackupManifest,
  scope: LaunchScope,
  cwd?: string,
): Promise<void> {
  const file = firstBackupFile(manifest);
  const restoreCwd = cwd ?? manifest.cwd;

  if (file.hadFile) {
    await adapter.writeConfig(file.content as Record<string, unknown>, scope, restoreCwd);
    return;
  }

  const configPath = file.path || adapter.configPaths(restoreCwd)[scope];
  await removeIfExists(configPath);
}

/**
 * Restores every file described by a backup manifest.
 *
 * Single-file manifests use the adapter's existing writeConfig pipeline.
 * Multi-file manifests require an adapter file-level restore hook so each
 * physical path can be restored or removed independently.
 */
export async function restoreBackupManifest(
  adapter: AgentAdapter,
  manifest: BackupManifest,
  scope: LaunchScope,
  cwd?: string,
): Promise<void> {
  if (manifest.files.length === 0) {
    throw new Error(`Backup for ${manifest.agentId} (${manifest.scope}) has no files`);
  }

  const restoreCwd = cwd ?? manifest.cwd;
  if (adapter.restoreConfigFile) {
    for (const file of manifest.files) {
      await adapter.restoreConfigFile(file, scope, restoreCwd);
    }
    return;
  }

  if (manifest.files.length > 1) {
    throw new Error(
      `Backup for ${manifest.agentId} (${manifest.scope}) contains multiple files, but ${adapter.id} does not support file-level restore`,
    );
  }

  await restorePrimaryBackupFile(adapter, manifest, scope, restoreCwd);
}
