import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { p, posix, win32, posixPath, winPath } from './paths.js';

describe('test path helpers', () => {
  it('p follows the host platform', () => {
    expect(p('/my/project', '.claude', 'settings.json')).toBe(
      path.join('/my/project', '.claude', 'settings.json'),
    );
  });

  it('posix always uses forward slashes', () => {
    expect(posix('/my/project', '.claude', 'settings.json')).toBe(
      '/my/project/.claude/settings.json',
    );
  });

  it('win32 always uses backslashes', () => {
    expect(win32('C:\\my\\project', '.claude', 'settings.json')).toBe(
      'C:\\my\\project\\.claude\\settings.json',
    );
    expect(win32('C:/my/project', '.claude', 'settings.json')).toBe(
      'C:\\my\\project\\.claude\\settings.json',
    );
  });

  it('win32 turns a POSIX-style root into a backslash path', () => {
    expect(win32('/my/project', '.qwen', 'settings.json')).toBe(
      '\\my\\project\\.qwen\\settings.json',
    );
  });

  it('posixPath / winPath rewrite separators only', () => {
    expect(posixPath('C:\\a\\b')).toBe('C:/a/b');
    expect(winPath('/a/b')).toBe('\\a\\b');
  });
});
