/**
 * The ЙЦУКЕН → QWERTY mapping behind every TUI hotkey.
 *
 * Hotkeys are compared as literal characters (`input === 'e'` for edit,
 * `'d'` for delete), so without this mapping the whole TUI is unusable with a
 * Russian layout active — and a wrong entry would silently bind a key to the
 * wrong action.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Key } from 'ink';

const handlers: Array<(input: string, key: Key) => void> = [];

vi.mock('ink', () => ({
  useInput: (handler: (input: string, key: Key) => void) => {
    handlers.push(handler);
  },
}));

const { useKeyInput } = await import('./use-key-input.js');

const KEY = {} as Key;

/** Runs useKeyInput's handler for one keypress and returns what it forwarded. */
function press(input: string): string {
  let seen = '';
  handlers.length = 0;
  useKeyInput((mapped) => {
    seen = mapped;
  });
  handlers[0]?.(input, KEY);
  return seen;
}

describe('useKeyInput', () => {
  it.each([
    ['у', 'e'],  // edit
    ['в', 'd'],  // delete
    ['ф', 'a'],  // add
    ['й', 'q'],  // quit
    ['г', 'u'],  // update
    ['и', 'b'],
    ['ш', 'i'],  // image capability
    ['м', 'v'],  // video capability
  ])('maps %s to %s', (ru, en) => {
    expect(press(ru)).toBe(en);
  });

  it('passes Latin input through unchanged', () => {
    for (const c of ['e', 'd', 'a', 'q', 'i', 'v']) {
      expect(press(c)).toBe(c);
    }
  });

  it('leaves unmapped characters alone', () => {
    expect(press('ъ')).toBe('ъ');
    expect(press('7')).toBe('7');
    expect(press('')).toBe('');
  });

  it('does not map uppercase — terminal hotkeys are case-sensitive', () => {
    expect(press('У')).toBe('У');
  });

  it('is injective, so no two Russian keys trigger the same action', () => {
    const RU = 'йцукенгшщзфывапролдячсмить';
    const mapped = [...RU].map(press);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});
