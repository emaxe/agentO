import { existsSync } from 'node:fs';
import path from 'node:path';
import { getEnvCI } from './env.js';

export interface ResolvedExecutable {
  path: string;
  /** `native` — a PE binary (`.exe`/`.com`); `shim` — a batch file run through `cmd.exe`. */
  kind: 'native' | 'shim';
}

export interface ResolveExecutableDeps {
  existsSync?: (candidate: string) => boolean;
  pathApi?: path.PlatformPath;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function stripQuotes(entry: string): string {
  return entry.replace(/^"(.*)"$/, '$1');
}

/**
 * Every file path `cmd` could refer to, in lookup order. Pure: no filesystem access.
 *
 * - a command with a path separator (or an absolute one) is not searched on PATH;
 * - otherwise each PATH directory is tried in order, quotes around entries removed;
 * - on win32 a command without extension gets each PATHEXT extension appended; one that
 *   already has an extension is tried as-is first, then with PATHEXT;
 * - on POSIX there are no extensions.
 */
export function candidatePaths(
  cmd: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  pathApi: path.PlatformPath,
): string[] {
  const win = platform === 'win32';

  let extensions: string[] = [''];
  if (win) {
    const pathExt = (getEnvCI(env, 'PATHEXT', platform) || DEFAULT_PATHEXT)
      .split(';')
      .filter(Boolean);
    extensions = pathApi.extname(cmd) ? ['', ...pathExt] : pathExt;
  }

  const hasSeparator = (win ? /[\\/]/ : /\//).test(cmd) || pathApi.isAbsolute(cmd);
  const directories = hasSeparator
    ? ['']
    : (getEnvCI(env, 'PATH', platform) ?? '')
        .split(win ? ';' : ':')
        .map(stripQuotes)
        .filter(Boolean);

  return directories.flatMap((directory) =>
    extensions.map((ext) => (directory ? pathApi.join(directory, cmd + ext) : cmd + ext)),
  );
}

function kindOf(file: string): ResolvedExecutable['kind'] {
  return /\.(?:cmd|bat)$/i.test(file) ? 'shim' : 'native';
}

/**
 * Finds the file a spawn of `cmd` would run, using the PATH/PATHEXT of `env` (the
 * environment the process will be started with, not necessarily `process.env`).
 *
 * Only meaningful on win32, where `cmd` may be a `.cmd` shim that `spawn` cannot
 * locate by itself. On POSIX returns `null` — `spawn` searches PATH on its own.
 */
export function resolveExecutable(
  cmd: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  deps: ResolveExecutableDeps = {},
): ResolvedExecutable | null {
  if (platform !== 'win32') return null;

  const exists = deps.existsSync ?? existsSync;
  const pathApi = deps.pathApi ?? path.win32;
  const found = candidatePaths(cmd, env, platform, pathApi).find((candidate) => exists(candidate));
  return found === undefined ? null : { path: found, kind: kindOf(found) };
}
