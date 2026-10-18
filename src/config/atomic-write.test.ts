import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fs = vi.hoisted(() => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock('node:fs/promises', () => fs);

import { renameWithRetry, unlinkWithRetry, writeFileAtomic } from './atomic-write.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.useFakeTimers();
  fs.writeFile.mockReset().mockResolvedValue(undefined);
  fs.rename.mockReset().mockResolvedValue(undefined);
  fs.unlink.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('renameWithRetry', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries %s on win32 until it succeeds', async (code) => {
    fs.rename
      .mockRejectedValueOnce(errno(code))
      .mockRejectedValueOnce(errno(code))
      .mockResolvedValueOnce(undefined);

    const done = renameWithRetry('a', 'b', 'win32');
    await vi.runAllTimersAsync();
    await done;

    expect(fs.rename).toHaveBeenCalledTimes(3);
    expect(fs.rename).toHaveBeenLastCalledWith('a', 'b');
  });

  it('backs off 25, 50, 100 ms … capped at 400 ms', async () => {
    fs.rename.mockRejectedValue(errno('EBUSY'));
    const done = renameWithRetry('a', 'b', 'win32').catch((e: unknown) => e);

    const expected = [25, 50, 100, 200, 400, 400, 400];
    for (const [i, delay] of expected.entries()) {
      await vi.advanceTimersByTimeAsync(0);
      expect(fs.rename).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fs.rename).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(await done).toMatchObject({ code: 'EBUSY' });
  });

  it('gives up after 8 attempts on win32 and rethrows the last error', async () => {
    fs.rename.mockRejectedValue(errno('EPERM'));

    const done = renameWithRetry('a', 'b', 'win32').catch((e: unknown) => e);
    await vi.runAllTimersAsync();

    expect(await done).toMatchObject({ code: 'EPERM' });
    expect(fs.rename).toHaveBeenCalledTimes(8);
  });

  it('does not retry other errors, such as ENOENT', async () => {
    fs.rename.mockRejectedValue(errno('ENOENT'));

    await expect(renameWithRetry('a', 'b', 'win32')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  it.each(['linux', 'darwin'] as const)('makes a single attempt on %s', async (platform) => {
    fs.rename.mockRejectedValue(errno('EPERM'));

    await expect(renameWithRetry('a', 'b', platform)).rejects.toMatchObject({ code: 'EPERM' });
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });
});

describe('unlinkWithRetry', () => {
  it('retries EBUSY on win32', async () => {
    fs.unlink.mockRejectedValueOnce(errno('EBUSY')).mockResolvedValueOnce(undefined);

    const done = unlinkWithRetry('f', 'win32');
    await vi.runAllTimersAsync();
    await done;

    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it('surfaces ENOENT immediately so callers can treat it as already gone', async () => {
    fs.unlink.mockRejectedValue(errno('ENOENT'));

    await expect(unlinkWithRetry('f', 'win32')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it('makes a single attempt on POSIX', async () => {
    fs.unlink.mockRejectedValue(errno('EACCES'));

    await expect(unlinkWithRetry('f', 'linux')).rejects.toMatchObject({ code: 'EACCES' });
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});

describe('writeFileAtomic', () => {
  it('writes a temp file next to the target, then renames it into place', async () => {
    await writeFileAtomic('/dir/config.json', '{}', 0o600);

    const tmp = fs.writeFile.mock.calls[0][0] as string;
    expect(tmp).toMatch(/^\/dir\/config\.json\.tmp-/);
    expect(fs.writeFile).toHaveBeenCalledWith(tmp, '{}', { encoding: 'utf-8', mode: 0o600 });
    expect(fs.rename).toHaveBeenCalledWith(tmp, '/dir/config.json');
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('removes the temp file and rethrows when the final rename fails', async () => {
    fs.rename.mockRejectedValue(errno('EISDIR'));

    await expect(writeFileAtomic('/dir/config.json', '{}')).rejects.toMatchObject({
      code: 'EISDIR',
    });

    const tmp = fs.writeFile.mock.calls[0][0] as string;
    expect(fs.unlink).toHaveBeenCalledWith(tmp);
  });

  it('removes the temp file after win32 retries are exhausted', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      fs.rename.mockRejectedValue(errno('EPERM'));

      const done = writeFileAtomic('C:\\cfg\\config.json', '{}').catch((e: unknown) => e);
      await vi.runAllTimersAsync();

      expect(await done).toMatchObject({ code: 'EPERM' });
      expect(fs.rename).toHaveBeenCalledTimes(8);
      expect(fs.unlink).toHaveBeenCalledTimes(1);
    } finally {
      platform.mockRestore();
    }
  });
});
