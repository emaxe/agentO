import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { ShellPathResolver } from './shell-path-resolver.js';

const mockExecFile = vi.mocked(execFile);

function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      // Extract delimiter from script args to wrap the path
      const args = _args as string[];
      const script = args[2]; // The -c argument
      const match = script.match(/printf '%s%s%s' '([^']+)'/);
      const delimiter = match?.[1] ?? '';
      callback(null, `${delimiter}${stdout}${delimiter}`, '');
      return {} as ReturnType<typeof execFile>;
    },
  );
}

function mockExecFileFailure() {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      callback(new Error('timeout'), '', '');
      return {} as ReturnType<typeof execFile>;
    },
  );
}

function mockExecFileWithOSC(path: string) {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
      const args = _args as string[];
      const script = args[2];
      const match = script.match(/printf '%s%s%s' '([^']+)'/);
      const delimiter = match?.[1] ?? '';
      // Simulate OSC sequences before the actual output
      callback(null, `\x1b]7;file:///Users/test\x07${delimiter}${path}${delimiter}`, '');
      return {} as ReturnType<typeof execFile>;
    },
  );
}

describe('ShellPathResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves PATH from shell output using delimiters', async () => {
    const resolver = new ShellPathResolver();
    mockExecFileSuccess('/usr/local/bin:/usr/bin:/bin');

    const result = await resolver.resolve();
    expect(result).toContain('/usr/local/bin');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/bin');
  });

  it('returns cached result on second call', async () => {
    const resolver = new ShellPathResolver();
    mockExecFileSuccess('/usr/local/bin:/bin');

    const first = await resolver.resolve();
    const second = await resolver.resolve();
    expect(first).toBe(second);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears cache, next resolve re-fetches', async () => {
    const resolver = new ShellPathResolver();
    mockExecFileSuccess('/usr/local/bin:/bin');

    await resolver.resolve();
    resolver.invalidate();
    expect(resolver.getResolvedPath()).toBeNull();

    await resolver.resolve();
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('falls back to system PATH on failure', async () => {
    const resolver = new ShellPathResolver();
    mockExecFileFailure();

    const result = await resolver.resolve();
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/bin');
  });

  it('getResolvedPath returns null before resolve', () => {
    const resolver = new ShellPathResolver();
    expect(resolver.getResolvedPath()).toBeNull();
  });

  it('strips OSC escape sequences from shell output', async () => {
    const resolver = new ShellPathResolver();
    mockExecFileWithOSC('/opt/homebrew/bin:/usr/local/bin');

    const result = await resolver.resolve();
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain('/usr/local/bin');
    expect(result).not.toContain('\x1b');
  });
});
