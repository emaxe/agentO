import { describe, expect, it } from 'vitest';
import { maskSecret } from './mask.js';

describe('maskSecret', () => {
  it('keeps only the last four characters of a long key', () => {
    const masked = maskSecret('fw-super-secret-key-value');
    expect(masked).toBe('••••••••alue');
    expect(masked).not.toContain('fw-super');
  });

  it('masks short keys completely', () => {
    expect(maskSecret('sk-x')).toBe('••••••••');
  });

  it('renders an empty string for an empty secret', () => {
    expect(maskSecret('')).toBe('');
  });
});
