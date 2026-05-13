import { describe, expect, it } from 'vitest';
import { mergeAgentConfig } from './merge-config.js';

describe('mergeAgentConfig', () => {
  it('preserves keys only in existing', () => {
    const existing = { keep: 1 };
    const generated = { newKey: 2 };
    expect(mergeAgentConfig(existing, generated, [])).toEqual({ keep: 1, newKey: 2 });
  });

  it('overwrites existing keys with generated values', () => {
    const existing = { overwrite: 'old' };
    const generated = { overwrite: 'new' };
    expect(mergeAgentConfig(existing, generated, [])).toEqual({ overwrite: 'new' });
  });

  it('replaces nested objects whole (no deep merge)', () => {
    const existing = { nested: { a: 1, b: 2 } };
    const generated = { nested: { c: 3 } };
    expect(mergeAgentConfig(existing, generated, [])).toEqual({ nested: { c: 3 } });
  });

  it('flattens env keys (envKeys flat merge)', () => {
    const existing = { env: { OLD: '1', KEEP: '2' } };
    const generated = { env: { NEW: '3', OLD: '4' } };
    expect(mergeAgentConfig(existing, generated, ['env'])).toEqual({
      env: { OLD: '4', KEEP: '2', NEW: '3' },
    });
  });

  it('falls back to replacement for envKey when value is not an object', () => {
    const existing = { env: 'string' };
    const generated = { env: { NEW: '1' } };
    expect(mergeAgentConfig(existing, generated, ['env'])).toEqual({ env: { NEW: '1' } });
  });

  it('falls back to replacement when existing envKey value is null', () => {
    const existing = { env: null };
    const generated = { env: { NEW: '1' } };
    expect(mergeAgentConfig(existing, generated, ['env'])).toEqual({ env: { NEW: '1' } });
  });

  it('does not merge env when envKeys is empty', () => {
    const existing = { env: { OLD: '1' } };
    const generated = { env: { NEW: '2' } };
    expect(mergeAgentConfig(existing, generated, [])).toEqual({ env: { NEW: '2' } });
  });

  it('handles arrays as replacement (not flat merge)', () => {
    const existing = { list: [1, 2] };
    const generated = { list: [3] };
    expect(mergeAgentConfig(existing, generated, ['list'])).toEqual({ list: [3] });
  });
});
