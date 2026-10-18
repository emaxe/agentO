import { describe, it, expect } from 'vitest';
import { sanitizeFieldValue } from './sanitize-field-value.js';

describe('sanitizeFieldValue', () => {
  it('removes \\r, \\n and \\r\\n', () => {
    expect(sanitizeFieldValue('sk-abc\r\n')).toBe('sk-abc');
    expect(sanitizeFieldValue('a\rb\nc')).toBe('abc');
    expect(sanitizeFieldValue('\r\n\r\n')).toBe('');
  });

  it('leaves other characters, spaces and tabs untouched', () => {
    expect(sanitizeFieldValue('my model\t1')).toBe('my model\t1');
    expect(sanitizeFieldValue('')).toBe('');
  });
});
