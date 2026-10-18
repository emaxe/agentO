import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Directories a login shell would normally contribute but a non-interactive
 * process often misses. POSIX-only — none of these exist on Windows.
 */
const FALLBACK_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  `${homedir()}/.cargo/bin`,
  `${homedir()}/.local/bin`,
];

/**
 * Directories where Windows tooling commonly installs agent CLIs. Rooted at environment
 * variables (not hardcoded drive letters) and only added when they exist on disk.
 */
const WIN32_FALLBACK_PATHS: ReadonlyArray<readonly [envVar: string, ...segments: string[]]> = [
  ['APPDATA', 'npm'],
  ['LOCALAPPDATA', 'pnpm'],
  ['LOCALAPPDATA', 'Microsoft', 'WinGet', 'Links'],
  ['USERPROFILE', '.local', 'bin'],
  ['USERPROFILE', '.cargo', 'bin'],
  ['USERPROFILE', 'scoop', 'shims'],
  ['ProgramFiles', 'nodejs'],
];

const POSIX_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Shell used to read the user's real PATH.
 *
 * `$SHELL` first: `/bin/zsh` is the macOS default but is frequently absent on
 * Linux, where hardcoding it made every probe fail and silently fall back.
 */
const DEFAULT_SHELL = '/bin/zsh';
const TIMEOUT_MS = 3000;
const DELIMITER = '_SHELL_PATH_DELIMITER_';

function execShell(shell: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout, env: process.env }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

export interface ShellPathResolverOptions {
  /** Defaults to `process.platform`; injectable so the Windows branch is testable. */
  platform?: NodeJS.Platform;
  /** Injectable directory-existence check (defaults to `fs.existsSync`); used for win32 fallbacks. */
  existsSync?: (dir: string) => boolean;
}

/**
 * Резолвит настоящий пользовательский PATH через login-shell.
 * Кэширует результат. Используется при запуске агентов в independent-режиме.
 *
 * On Windows there is no login shell to interrogate — environment variables are
 * inherited normally — so the probe is skipped and `%Path%` is used directly.
 */
export class ShellPathResolver {
  private _resolvedPath: string | null = null;
  private _promise: Promise<string> | null = null;
  private readonly _platform: NodeJS.Platform;
  private readonly _exists: (dir: string) => boolean;

  constructor(options: ShellPathResolverOptions = {}) {
    this._platform = options.platform ?? process.platform;
    this._exists = options.existsSync ?? existsSync;
  }

  async resolve(): Promise<string> {
    if (this._resolvedPath !== null) {
      return this._resolvedPath;
    }
    if (this._promise !== null) {
      return this._promise;
    }
    this._promise = this._doResolve();
    this._resolvedPath = await this._promise;
    this._promise = null;
    return this._resolvedPath;
  }

  getResolvedPath(): string | null {
    return this._resolvedPath;
  }

  invalidate(): void {
    this._resolvedPath = null;
    this._promise = null;
  }

  private get _isWindows(): boolean {
    return this._platform === 'win32';
  }

  /**
   * The delimiter this platform separates PATH entries with.
   * Keyed off the injected platform rather than `node:path`, so the behaviour
   * under test is the target platform's, not the host's.
   */
  private get _delimiter(): string {
    return this._isWindows ? ';' : ':';
  }

  /** Windows spells the variable `Path`; Node also mirrors it as `PATH`. */
  private get _systemPath(): string {
    if (this._isWindows) {
      return process.env.Path ?? process.env.PATH ?? '';
    }
    return process.env.PATH || POSIX_SYSTEM_PATH;
  }

  private async _doResolve(): Promise<string> {
    // Windows has no login-shell equivalent worth probing, and running one would
    // only produce a POSIX-shaped PATH that means nothing to CreateProcess.
    if (this._isWindows) {
      return this._dedupe([...this._systemPath.split(';'), ...this._windowsFallbackDirs()]);
    }

    const delimiter = `${DELIMITER}_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
    const script = `printf '%s%s%s' '${delimiter}' "\${PATH}" '${delimiter}'`;
    const shell = process.env.SHELL || DEFAULT_SHELL;

    try {
      const stdout = await execShell(shell, ['-l', '-i', '-c', script], TIMEOUT_MS);

      // Remove OSC escape sequences that macOS zsh may emit
      // eslint-disable-next-line no-control-regex -- intentionally strips OSC ANSI sequences from interactive zsh output.
      const raw = (stdout || '').replace(/\x1b\][0-9]*;[^\x07]*\x07/g, '');
      const start = raw.indexOf(delimiter);
      const end = raw.indexOf(delimiter, start + delimiter.length);

      let resolved: string;
      if (start !== -1 && end !== -1 && end > start) {
        resolved = raw.slice(start + delimiter.length, end);
      } else {
        resolved = raw.trim();
      }

      if (resolved) {
        return this._mergeWithSystemPath(resolved);
      }
    } catch {
      // Fall through to fallback
    }

    return this._buildFallbackPath();
  }

  /** Existing well-known install directories, resolved from the environment (win32 only). */
  private _windowsFallbackDirs(): string[] {
    const dirs: string[] = [];
    for (const [envVar, ...segments] of WIN32_FALLBACK_PATHS) {
      const root = envVar ? this._winEnv(envVar) : undefined;
      if (!root) continue;
      const dir = path.win32.join(root, ...segments);
      if (this._exists(dir)) dirs.push(dir);
    }
    return dirs;
  }

  /** Windows environment names are case-insensitive. */
  private _winEnv(name: string): string | undefined {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : process.env[key];
  }

  private _dedupe(parts: string[]): string {
    if (!this._isWindows) {
      return [...new Set(parts)].filter(Boolean).join(this._delimiter);
    }
    // Windows paths compare case-insensitively and a trailing separator is not significant.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const part of parts) {
      if (!part) continue;
      const key = part.replace(/[\\/]+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(part);
    }
    return unique.join(this._delimiter);
  }

  private _mergeWithSystemPath(resolved: string): string {
    const sep = this._delimiter;
    const system = this._systemPath.split(sep).filter(Boolean);
    const cleaned = (resolved || '').replace(new RegExp(`_?${DELIMITER}[^${sep}]*`, 'g'), '');
    const user = cleaned.split(sep).filter(Boolean);
    return this._dedupe([...user, ...system]);
  }

  private _buildFallbackPath(): string {
    const sep = this._delimiter;
    const parts = [...this._systemPath.split(sep), ...FALLBACK_PATHS];
    return this._mergeWithSystemPath(this._dedupe(parts));
  }
}

/** Singleton instance for reuse across the application */
export const shellPathResolver = new ShellPathResolver();
