import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { ShellPathResolver } from './shell-path-resolver.js';

const mockExecFile = vi.mocked(execFile);

function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    // Extract delimiter from script args to wrap the path
    const args = _args as string[];
    const script = args[2]; // The -c argument
    const match = script.match(/printf '%s%s%s' '([^']+)'/);
    const delimiter = match?.[1] ?? '';
    callback(null, `${delimiter}${stdout}${delimiter}`, '');
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileFailure() {
  mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    callback(new Error('timeout'), '', '');
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileWithOSC(path: string) {
  mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    const args = _args as string[];
    const script = args[2];
    const match = script.match(/printf '%s%s%s' '([^']+)'/);
    const delimiter = match?.[1] ?? '';
    // Simulate OSC sequences before the actual output
    callback(null, `\x1b]7;file:///Users/test\x07${delimiter}${path}${delimiter}`, '');
    return {} as ReturnType<typeof execFile>;
  });
}

describe('ShellPathResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves PATH from shell output using delimiters', async () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    mockExecFileSuccess('/usr/local/bin:/usr/bin:/bin');

    const result = await resolver.resolve();
    expect(result).toContain('/usr/local/bin');
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/bin');
  });

  it('returns cached result on second call', async () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    mockExecFileSuccess('/usr/local/bin:/bin');

    const first = await resolver.resolve();
    const second = await resolver.resolve();
    expect(first).toBe(second);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears cache, next resolve re-fetches', async () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    mockExecFileSuccess('/usr/local/bin:/bin');

    await resolver.resolve();
    resolver.invalidate();
    expect(resolver.getResolvedPath()).toBeNull();

    await resolver.resolve();
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('falls back to system PATH on failure', async () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    mockExecFileFailure();

    const result = await resolver.resolve();
    expect(result).toContain('/usr/bin');
    expect(result).toContain('/bin');
  });

  it('getResolvedPath returns null before resolve', () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    expect(resolver.getResolvedPath()).toBeNull();
  });

  it('strips OSC escape sequences from shell output', async () => {
    const resolver = new ShellPathResolver({ platform: 'darwin' });
    mockExecFileWithOSC('/opt/homebrew/bin:/usr/local/bin');

    const result = await resolver.resolve();
    expect(result).toContain('/opt/homebrew/bin');
    expect(result).toContain('/usr/local/bin');
    expect(result).not.toContain('\x1b');
  });
});

describe('ShellPathResolver on Windows', () => {
  const originalPath = process.env.PATH;
  const originalWinPath = process.env.Path;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalWinPath === undefined) delete process.env.Path;
    else process.env.Path = originalWinPath;
  });

  it('never invokes a login shell', async () => {
    // /bin/zsh does not exist on Windows; probing for it only wasted a timeout
    // and then fell back to a POSIX path list that CreateProcess cannot use.
    process.env.Path = 'C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm';
    const resolver = new ShellPathResolver({ platform: 'win32' });

    const result = await resolver.resolve();

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(result).toBe('C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm');
  });

  it('splits on ; so the PATH is not collapsed into one bogus entry', async () => {
    // Splitting on ':' turned the whole Windows PATH into a single element —
    // and 'C' plus a drive letter is not a directory.
    process.env.Path = 'C:\\a;C:\\b;C:\\a';
    const resolver = new ShellPathResolver({ platform: 'win32' });

    expect((await resolver.resolve()).split(';')).toEqual(['C:\\a', 'C:\\b']);
  });

  it('adds no POSIX fallback directories', async () => {
    process.env.Path = 'C:\\Windows\\system32';
    const resolver = new ShellPathResolver({ platform: 'win32' });

    const result = await resolver.resolve();

    expect(result).not.toContain('/usr/bin');
    expect(result).not.toContain('/opt/homebrew/bin');
  });

  it('falls back to PATH when Path is unset', async () => {
    delete process.env.Path;
    process.env.PATH = 'C:\\only';
    const resolver = new ShellPathResolver({ platform: 'win32' });

    expect(await resolver.resolve()).toBe('C:\\only');
  });
});

describe('ShellPathResolver shell selection', () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
  });

  it('uses the user login shell', async () => {
    // Hardcoding /bin/zsh made the probe fail outright on a Linux box where zsh
    // is not installed, silently degrading every launch to the fallback PATH.
    process.env.SHELL = '/usr/bin/fish';
    mockExecFileSuccess('/usr/local/bin');

    await new ShellPathResolver({ platform: 'linux' }).resolve();

    expect(mockExecFile.mock.calls[0]?.[0]).toBe('/usr/bin/fish');
  });

  it('falls back to /bin/zsh when SHELL is unset', async () => {
    delete process.env.SHELL;
    mockExecFileSuccess('/usr/local/bin');

    await new ShellPathResolver({ platform: 'darwin' }).resolve();

    expect(mockExecFile.mock.calls[0]?.[0]).toBe('/bin/zsh');
  });
});

describe('ShellPathResolver Windows fallback directories', () => {
  const touched = ['Path', 'PATH', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramFiles'];
  const saved = new Map(touched.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of touched) delete process.env[key];
    process.env.Path = 'C:\\Windows\\system32';
    process.env.APPDATA = 'C:\\Users\\me\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local';
    process.env.USERPROFILE = 'C:\\Users\\me';
    process.env.ProgramFiles = 'C:\\Program Files';
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const allDirs = [
    'C:\\Users\\me\\AppData\\Roaming\\npm',
    'C:\\Users\\me\\AppData\\Local\\pnpm',
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
    'C:\\Users\\me\\.local\\bin',
    'C:\\Users\\me\\.cargo\\bin',
    'C:\\Users\\me\\scoop\\shims',
    'C:\\Program Files\\nodejs',
  ];

  it('appends every well-known directory that exists', async () => {
    const resolver = new ShellPathResolver({ platform: 'win32', existsSync: () => true });

    expect((await resolver.resolve()).split(';')).toEqual(['C:\\Windows\\system32', ...allDirs]);
  });

  it('skips directories that do not exist', async () => {
    const existing = new Set([allDirs[0], allDirs[6]]);
    const resolver = new ShellPathResolver({
      platform: 'win32',
      existsSync: (dir) => existing.has(dir),
    });

    expect((await resolver.resolve()).split(';')).toEqual([
      'C:\\Windows\\system32',
      allDirs[0],
      allDirs[6],
    ]);
  });

  it('does not duplicate entries already on PATH, ignoring case and trailing separators', async () => {
    process.env.Path =
      'C:\\Windows\\system32;c:\\users\\ME\\appdata\\roaming\\NPM\\;C:\\Program Files\\nodejs';
    const resolver = new ShellPathResolver({ platform: 'win32', existsSync: () => true });

    const parts = (await resolver.resolve()).split(';');

    expect(parts.slice(0, 3)).toEqual([
      'C:\\Windows\\system32',
      'c:\\users\\ME\\appdata\\roaming\\NPM\\',
      'C:\\Program Files\\nodejs',
    ]);
    expect(parts).toHaveLength(allDirs.length + 1);
  });

  it('skips fallbacks whose root variable is unset', async () => {
    delete process.env.LOCALAPPDATA;
    const resolver = new ShellPathResolver({ platform: 'win32', existsSync: () => true });

    const result = await resolver.resolve();

    expect(result).not.toContain('pnpm');
    expect(result).not.toContain('WinGet');
    expect(result).toContain('C:\\Users\\me\\scoop\\shims');
  });

  it('never consults the filesystem or adds Windows directories on POSIX', async () => {
    const exists = vi.fn(() => true);
    mockExecFileSuccess('/usr/local/bin:/usr/bin');
    const resolver = new ShellPathResolver({ platform: 'darwin', existsSync: exists });

    const result = await resolver.resolve();

    expect(exists).not.toHaveBeenCalled();
    expect(result).not.toContain('\\');
  });
});
