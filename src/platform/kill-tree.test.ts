import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mocks = vi.hoisted(() => ({ spawnCommand: vi.fn() }));
vi.mock('./spawn.js', () => ({ spawnCommand: mocks.spawnCommand }));

import { killTree } from './kill-tree.js';

function fakeChild(pid?: number) {
  return { pid, kill: vi.fn() };
}

beforeEach(() => {
  mocks.spawnCommand.mockReset();
});

describe('killTree (POSIX)', () => {
  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)('forwards %s to child.kill', (signal) => {
    const child = fakeChild(4242);
    killTree(child, signal, 'linux');
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
    expect(mocks.spawnCommand).not.toHaveBeenCalled();
  });

  it('maps force to SIGKILL', () => {
    const child = fakeChild(4242);
    killTree(child, 'force', 'darwin');
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  });
});

describe('killTree (win32)', () => {
  it('runs taskkill /T /F for the pid', () => {
    const killer = new EventEmitter();
    mocks.spawnCommand.mockReturnValue(killer);
    const child = fakeChild(1234);

    killTree(child, 'SIGTERM', 'win32');

    expect(mocks.spawnCommand).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.emit('exit', 0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to child.kill() when taskkill fails to start', () => {
    const killer = new EventEmitter();
    mocks.spawnCommand.mockReturnValue(killer);
    const child = fakeChild(4242);

    killTree(child, 'force', 'win32');
    killer.emit('error', new Error('spawn taskkill ENOENT'));

    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('falls back to child.kill() when taskkill exits non-zero', () => {
    const killer = new EventEmitter();
    mocks.spawnCommand.mockReturnValue(killer);
    const child = fakeChild(4242);

    killTree(child, 'force', 'win32');
    killer.emit('exit', 1);

    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('kills the child directly when it has no pid', () => {
    const child = fakeChild(undefined);
    killTree(child, 'force', 'win32');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.spawnCommand).not.toHaveBeenCalled();
  });
});
