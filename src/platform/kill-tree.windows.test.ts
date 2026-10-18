import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { killTree } from './kill-tree.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Runs on windows-latest only: exercises the real `taskkill /T /F`. */
describe.skipIf(process.platform !== 'win32')('killTree (Windows, real taskkill)', () => {
  it('terminates a cmd.exe process and the ping it started', async () => {
    // ping is a grandchild of this test: plain child.kill() would leave it running.
    const child = spawn('cmd', ['/c', 'ping', '-n', '30', '127.0.0.1'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error('cmd.exe did not start');

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(isAlive(pid)).toBe(true);

    killTree(child, 'force', 'win32');

    await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('process survived killTree')), 10_000),
      ),
    ]);

    expect(isAlive(pid)).toBe(false);
  }, 20_000);
});
