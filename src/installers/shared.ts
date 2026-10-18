import type { InstallCheckResult, InstallResult } from './base.js';
import { setEnvCI } from '../platform/env.js';
import { spawnCommand, spawnCommandSync } from '../platform/spawn.js';
import { shellPathResolver } from '../launcher/shell-path-resolver.js';

export interface InstallerOptions {
  /** Defaults to `process.platform`; injectable so every platform branch is testable. */
  platform?: NodeJS.Platform;
}

export const VERSION_PROBE_TIMEOUT_MS = 10_000;
export const defaultVersionRegex = /(\d+\.\d+\.\d+[^\s]*)/;

/** `process.env` with the user's real (resolved) PATH, as agents are launched with. */
export async function resolvedEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  setEnvCI(env, 'PATH', await shellPathResolver.resolve());
  return env;
}

/** Runs `<command> --version` and classifies the outcome. */
export async function probeVersion(
  command: string,
  versionRegex: RegExp = defaultVersionRegex,
): Promise<InstallCheckResult> {
  const result = spawnCommandSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_PROBE_TIMEOUT_MS,
    env: await resolvedEnv(),
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return { installed: false, reason: 'not-found' };
  if (code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    return { installed: false, reason: 'timeout' };
  }
  if (result.error || result.status !== 0) return { installed: false, reason: 'failed' };

  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const version = output.match(versionRegex)?.[1];
  return { installed: true, ...(version !== undefined ? { version } : {}) };
}

/** True when `<command> --version` exits 0 (used for prerequisite checks). */
export async function commandAvailable(command: string): Promise<boolean> {
  const result = spawnCommandSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_PROBE_TIMEOUT_MS,
    env: await resolvedEnv(),
  });
  return !result.error && result.status === 0;
}

export interface RunCommandOptions {
  /** Appended to the error text when the failure looks like a permissions problem. */
  permissionHint?: string;
}

const PERMISSION_ERROR = /\b(EPERM|EACCES)\b/;

/**
 * Runs an installer command, streaming stdout to the terminal and collecting stderr.
 * A successful run invalidates the cached PATH so a freshly installed agent is found.
 */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<InstallResult> {
  const env = await resolvedEnv();
  return new Promise<InstallResult>((resolve) => {
    const stderrChunks: Buffer[] = [];

    const child = spawnCommand(command, args, {
      stdio: ['ignore', 'inherit', 'pipe'],
      shell: false,
      env,
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        shellPathResolver.invalidate();
        resolve({ success: true });
        return;
      }
      let error =
        Buffer.concat(stderrChunks).toString('utf8').trim() ||
        `${command} exited with code ${code}`;
      if (options.permissionHint && PERMISSION_ERROR.test(error)) {
        error += `\n${options.permissionHint}`;
      }
      resolve({ success: false, error });
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
