import { describe, expect, it } from 'vitest';
import { findNonAsciiApiKeyChar, validateProvider } from './validation.js';
import type { Provider } from './schema.js';

const validProviderInput = {
  name: 'OpenR',
  type: 'openai-compatible',
  apiKey: 'sk-abc123',
  baseUrl: 'https://api.example.com/v1',
  models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }],
};

const existing: Provider[] = [];

describe('findNonAsciiApiKeyChar', () => {
  it('returns null for an ASCII key', () => {
    expect(findNonAsciiApiKeyChar('sk-or-v1-abc123')).toBeNull();
  });

  it('reports the character and its zero-based index', () => {
    expect(findNonAsciiApiKeyChar('or-proxy-keн')).toEqual({ index: 11, char: 'н' });
  });

  it('reports non-Latin1 letters, not just Cyrillic', () => {
    expect(findNonAsciiApiKeyChar('sk-ü')).toEqual({ index: 3, char: 'ü' });
  });
});

describe('validateProvider API key charset', () => {
  it('accepts an ASCII key', () => {
    expect(() => validateProvider(validProviderInput, existing)).not.toThrow();
  });

  it('rejects a key typed with the Russian keyboard layout and names the position', () => {
    expect(() =>
      validateProvider({ ...validProviderInput, apiKey: 'or-proxy-keн' }, existing),
    ).toThrow(/non-ASCII character "н" at position 12/);
  });
});
