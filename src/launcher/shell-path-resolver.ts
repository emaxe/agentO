import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

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

const SHELL = '/bin/zsh';
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

/**
 * Резолвит настоящий пользовательский PATH через login-shell.
 * Кэширует результат. Используется при запуске агентов в independent-режиме.
 */
export class ShellPathResolver {
  private _resolvedPath: string | null = null;
  private _promise: Promise<string> | null = null;

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

  private async _doResolve(): Promise<string> {
    const delimiter = `${DELIMITER}_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
    const script = `printf '%s%s%s' '${delimiter}' "\${PATH}" '${delimiter}'`;

    try {
      const stdout = await execShell(SHELL, ['-l', '-i', '-c', script], TIMEOUT_MS);

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

  private _mergeWithSystemPath(resolved: string): string {
    const system = (process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin')
      .split(':')
      .filter(Boolean);
    const cleaned = (resolved || '').replace(
      new RegExp(`_?${DELIMITER}[^:]*`, 'g'),
      '',
    );
    const user = cleaned.split(':').filter(Boolean);
    const merged = [...new Set([...user, ...system])];
    return merged.join(':');
  }

  private _buildFallbackPath(): string {
    const base = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
    const parts = [...base.split(':'), ...FALLBACK_PATHS];
    const resolved = [...new Set(parts)].filter(Boolean).join(':');
    return this._mergeWithSystemPath(resolved);
  }
}

/** Singleton instance for reuse across the application */
export const shellPathResolver = new ShellPathResolver();
