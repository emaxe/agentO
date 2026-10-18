import type { ChildProcess } from 'node:child_process';
import { spawnCommand } from './spawn.js';

export type KillMode = NodeJS.Signals | 'force';

/** The part of a `ChildProcess` that `killTree` (and signal forwarding) needs. */
export type KillableProcess = Pick<ChildProcess, 'pid' | 'kill'>;

/**
 * Terminates `child` and, on Windows, its whole process tree.
 *
 * POSIX: forwards the signal (`force` is SIGKILL). Windows has no signals and
 * `child.kill()` leaves grandchildren (e.g. an agent started through a `.cmd` shim)
 * running, so `taskkill /T /F` is used, falling back to `child.kill()`.
 */
export function killTree(
  child: KillableProcess,
  mode: KillMode,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') {
    child.kill(mode === 'force' ? 'SIGKILL' : mode);
    return;
  }

  if (child.pid === undefined) {
    child.kill();
    return;
  }

  const killer = spawnCommand('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.on('error', () => {
    child.kill();
  });
  killer.on('exit', (code) => {
    if (code !== 0) child.kill();
  });
}
