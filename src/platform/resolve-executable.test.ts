import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { candidatePaths, resolveExecutable } from './resolve-executable.js';

const win = path.win32;
const posix = path.posix;

describe('candidatePaths (win32)', () => {
  it('tries PATH directories in order, PATHEXT in its own order', () => {
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' };
    expect(candidatePaths('agent', env, 'win32', win)).toEqual([
      'C:\\a\\agent.EXE',
      'C:\\a\\agent.CMD',
      'C:\\b\\agent.EXE',
      'C:\\b\\agent.CMD',
    ]);
  });

  it('defaults PATHEXT to .COM;.EXE;.BAT;.CMD', () => {
    expect(candidatePaths('agent', { PATH: 'C:\\a' }, 'win32', win)).toEqual([
      'C:\\a\\agent.COM',
      'C:\\a\\agent.EXE',
      'C:\\a\\agent.BAT',
      'C:\\a\\agent.CMD',
    ]);
  });

  it('tries a command that already has an extension as-is first, then with PATHEXT', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE;.CMD' };
    expect(candidatePaths('npm.cmd', env, 'win32', win)).toEqual([
      'C:\\a\\npm.cmd',
      'C:\\a\\npm.cmd.EXE',
      'C:\\a\\npm.cmd.CMD',
    ]);
  });

  it('does not search PATH for an absolute path, only adds PATHEXT', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE;.CMD' };
    expect(candidatePaths('C:\\tools\\agent', env, 'win32', win)).toEqual([
      'C:\\tools\\agent.EXE',
      'C:\\tools\\agent.CMD',
    ]);
    expect(candidatePaths('C:\\tools\\agent.exe', env, 'win32', win)[0]).toBe(
      'C:\\tools\\agent.exe',
    );
  });

  it('treats a relative command with a separator as a path, not a PATH lookup', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE' };
    expect(candidatePaths('.\\bin\\agent', env, 'win32', win)).toEqual(['.\\bin\\agent.EXE']);
    expect(candidatePaths('bin/agent', env, 'win32', win)).toEqual(['bin/agent.EXE']);
  });

  it('strips quotes around PATH entries', () => {
    const env = { PATH: '"C:\\Program Files\\nodejs";C:\\b', PATHEXT: '.CMD' };
    expect(candidatePaths('npm', env, 'win32', win)).toEqual([
      'C:\\Program Files\\nodejs\\npm.CMD',
      'C:\\b\\npm.CMD',
    ]);
  });

  it('reads Path and PATHEXT regardless of key case', () => {
    const env = { Path: 'C:\\a', pathext: '.EXE' };
    expect(candidatePaths('agent', env, 'win32', win)).toEqual(['C:\\a\\agent.EXE']);
  });

  it('returns nothing for an empty or missing PATH', () => {
    expect(candidatePaths('agent', { PATH: '' }, 'win32', win)).toEqual([]);
    expect(candidatePaths('agent', {}, 'win32', win)).toEqual([]);
    expect(candidatePaths('agent', { PATH: ';;' }, 'win32', win)).toEqual([]);
  });
});

describe('candidatePaths (posix)', () => {
  it('uses ":" and no extensions', () => {
    expect(candidatePaths('agent', { PATH: '/usr/bin:/bin' }, 'linux', posix)).toEqual([
      '/usr/bin/agent',
      '/bin/agent',
    ]);
  });

  it('ignores PATHEXT and does not add extensions', () => {
    expect(candidatePaths('agent.js', { PATH: '/bin', PATHEXT: '.EXE' }, 'linux', posix)).toEqual([
      '/bin/agent.js',
    ]);
  });

  it('uses an absolute command as-is', () => {
    expect(candidatePaths('/opt/agent', { PATH: '/bin' }, 'linux', posix)).toEqual(['/opt/agent']);
  });
});

describe('resolveExecutable', () => {
  const existing = (...files: string[]) => ({
    existsSync: (candidate: string) => files.includes(candidate),
    pathApi: win,
  });

  it('returns the first existing candidate with kind native for .exe', () => {
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' };
    const result = resolveExecutable(
      'agent',
      env,
      'win32',
      existing('C:\\a\\agent.CMD', 'C:\\b\\agent.EXE'),
    );
    expect(result).toEqual({ path: 'C:\\a\\agent.CMD', kind: 'shim' });
  });

  it('classifies .exe and .com as native, .cmd and .bat as shim', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE;.COM;.BAT;.CMD' };
    const kind = (file: string) =>
      resolveExecutable('x', env, 'win32', existing(`C:\\a\\x${file}`))?.kind;
    expect(kind('.EXE')).toBe('native');
    expect(kind('.COM')).toBe('native');
    expect(kind('.BAT')).toBe('shim');
    expect(kind('.CMD')).toBe('shim');
  });

  it('honours PATH order over PATHEXT order across directories', () => {
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' };
    const result = resolveExecutable(
      'agent',
      env,
      'win32',
      existing('C:\\a\\agent.CMD', 'C:\\b\\agent.EXE'),
    );
    expect(result?.path).toBe('C:\\a\\agent.CMD');
  });

  it('resolves an absolute path', () => {
    const result = resolveExecutable(
      'C:\\tools\\agent',
      { PATH: '' },
      'win32',
      existing('C:\\tools\\agent.EXE'),
    );
    expect(result).toEqual({ path: 'C:\\tools\\agent.EXE', kind: 'native' });
  });

  it('finds a command in a quoted PATH entry', () => {
    const result = resolveExecutable(
      'npm',
      { Path: '"C:\\Program Files\\nodejs"', PATHEXT: '.CMD' },
      'win32',
      existing('C:\\Program Files\\nodejs\\npm.CMD'),
    );
    expect(result).toEqual({ path: 'C:\\Program Files\\nodejs\\npm.CMD', kind: 'shim' });
  });

  it('returns null when nothing exists or PATH is empty', () => {
    expect(resolveExecutable('agent', { PATH: 'C:\\a' }, 'win32', existing())).toBeNull();
    expect(
      resolveExecutable('agent', { PATH: '' }, 'win32', existing('C:\\a\\agent.EXE')),
    ).toBeNull();
  });

  it('returns null on POSIX without touching the filesystem', () => {
    let calls = 0;
    const result = resolveExecutable('sh', { PATH: '/bin' }, 'linux', {
      existsSync: () => {
        calls += 1;
        return true;
      },
    });
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});
