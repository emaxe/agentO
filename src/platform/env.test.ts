import { describe, it, expect } from 'vitest';
import { getEnvCI, setEnvCI } from './env.js';

describe('getEnvCI', () => {
  it('finds Path by the name PATH on win32', () => {
    expect(getEnvCI({ Path: 'C:\\bin' }, 'PATH', 'win32')).toBe('C:\\bin');
  });

  it('prefers the exact spelling when several exist on win32', () => {
    expect(getEnvCI({ Path: 'a', PATH: 'b' }, 'PATH', 'win32')).toBe('b');
  });

  it('returns undefined when the variable is absent', () => {
    expect(getEnvCI({ OTHER: '1' }, 'PATH', 'win32')).toBeUndefined();
  });

  it('is case-sensitive on POSIX', () => {
    expect(getEnvCI({ Path: 'x' }, 'PATH', 'linux')).toBeUndefined();
    expect(getEnvCI({ PATH: '/bin' }, 'PATH', 'linux')).toBe('/bin');
  });
});

describe('setEnvCI', () => {
  it('leaves exactly one PATH key on win32, keeping the existing spelling', () => {
    const env: Record<string, string | undefined> = { Path: 'old', OTHER: '1' };
    setEnvCI(env, 'PATH', 'new', 'win32');
    expect(env).toEqual({ Path: 'new', OTHER: '1' });
  });

  it('removes other-case duplicates on win32', () => {
    const env: Record<string, string | undefined> = { Path: 'a', PATH: 'b', path: 'c' };
    setEnvCI(env, 'PATH', 'new', 'win32');
    expect(Object.keys(env)).toEqual(['PATH']);
    expect(env['PATH']).toBe('new');
  });

  it('adds the key with the given name when absent on win32', () => {
    const env: Record<string, string | undefined> = {};
    setEnvCI(env, 'PATH', 'v', 'win32');
    expect(env).toEqual({ PATH: 'v' });
  });

  it('does not touch other-case keys on POSIX', () => {
    const env: Record<string, string | undefined> = { Path: 'a' };
    setEnvCI(env, 'PATH', 'b', 'linux');
    expect(env).toEqual({ Path: 'a', PATH: 'b' });
  });
});
