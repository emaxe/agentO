import { describe, it, expect } from 'vitest';
import { tuiBorderStyle } from './border-style.js';

describe('tuiBorderStyle', () => {
  it('uses classic on bare win32 consoles (conhost)', () => {
    expect(tuiBorderStyle({}, 'win32')).toBe('classic');
  });

  it('uses round in Windows Terminal', () => {
    expect(tuiBorderStyle({ WT_SESSION: 'abc' }, 'win32')).toBe('round');
  });

  it('uses round when TERM_PROGRAM is set on win32', () => {
    expect(tuiBorderStyle({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe('round');
    expect(tuiBorderStyle({ TERM_PROGRAM: 'iTerm.app' }, 'win32')).toBe('round');
  });

  it('uses round on darwin and linux regardless of env', () => {
    expect(tuiBorderStyle({}, 'darwin')).toBe('round');
    expect(tuiBorderStyle({}, 'linux')).toBe('round');
  });
});
