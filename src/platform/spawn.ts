import { ChildProcess } from 'node:child_process';
import type {
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncOptionsWithBufferEncoding,
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';
import { PassThrough } from 'node:stream';
import crossSpawn from 'cross-spawn';
import { resolveExecutable } from './resolve-executable.js';

/**
 * The only place that starts processes.
 *
 * On POSIX these are transparent pass-throughs to `child_process` (cross-spawn does
 * nothing there). On win32 the command is resolved against PATH/PATHEXT of the env the
 * process will run with, so a missing command surfaces as a real `ENOENT` instead of
 * an exit code from `cmd.exe`, and `.cmd` shims are launched through cross-spawn's
 * escaping. `shell: true` is never used.
 */

function enoentError(cmd: string, args: readonly string[]): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${cmd} ENOENT`), {
    code: 'ENOENT',
    errno: -4058,
    syscall: `spawn ${cmd}`,
    path: cmd,
    spawnargs: [...args],
  });
}

function isPiped(stdio: SpawnOptions['stdio'], index: number): boolean {
  if (stdio === undefined || stdio === 'pipe') return true;
  if (typeof stdio === 'string') return false;
  const entry = stdio[index];
  return entry === undefined || entry === null || entry === 'pipe';
}

/** A child that "failed to spawn": emits `error` asynchronously, like Node does for ENOENT. */
function failedChild(error: NodeJS.ErrnoException, stdio: SpawnOptions['stdio']): ChildProcess {
  const child = new ChildProcess();
  child.stdin = isPiped(stdio, 0) ? new PassThrough() : null;
  child.stdout = isPiped(stdio, 1) ? new PassThrough() : null;
  child.stderr = isPiped(stdio, 2) ? new PassThrough() : null;
  process.nextTick(() => {
    child.stdout?.push(null);
    child.stderr?.push(null);
    child.emit('error', error);
  });
  return child;
}

export function spawnCommand(
  cmd: string,
  args: readonly string[],
  opts: SpawnOptions = {},
): ChildProcess {
  let file = cmd;
  if (process.platform === 'win32') {
    const resolved = resolveExecutable(cmd, opts.env ?? process.env, process.platform);
    if (!resolved) return failedChild(enoentError(cmd, args), opts.stdio);
    file = resolved.path;
  }
  return crossSpawn(file, args, { shell: false, ...opts });
}

export function spawnCommandSync(
  cmd: string,
  args: readonly string[],
  opts: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
export function spawnCommandSync(
  cmd: string,
  args: readonly string[],
  opts: SpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer>;
export function spawnCommandSync(
  cmd: string,
  args: readonly string[],
  opts?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer>;
export function spawnCommandSync(
  cmd: string,
  args: readonly string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  let file = cmd;
  if (process.platform === 'win32') {
    const resolved = resolveExecutable(cmd, opts.env ?? process.env, process.platform);
    if (!resolved) {
      // Same shape `spawnSync` returns when the command does not exist.
      return {
        error: enoentError(cmd, args),
        status: null,
        signal: null,
        output: null,
        pid: 0,
        stdout: null,
        stderr: null,
      } as unknown as SpawnSyncReturns<string | Buffer>;
    }
    file = resolved.path;
  }
  return crossSpawn.sync(file, args, { shell: false, ...opts });
}
