import { describe, expect, it } from 'vitest';
import { mapRussianLayout } from './keyboard-layout.js';

describe('mapRussianLayout', () => {
  it('maps a Cyrillic letter to the QWERTY key in that position', () => {
    expect(mapRussianLayout('н')).toBe('y');
    expect(mapRussianLayout('Н')).toBe('Y');
  });

  it('repairs an API key whose last letter was typed on the Russian layout', () => {
    // The reported bug: "or-proxy-key" typed with the layout switching before the
    // final "y" produced "or-proxy-keн", which fetch refused to send as a header.
    expect(mapRussianLayout('or-proxy-keн')).toBe('or-proxy-key');
  });

  it('maps a whole word typed on the Russian layout', () => {
    expect(mapRussianLayout('фьщку')).toBe('amore');
  });

  it('leaves ASCII, digits and punctuation untouched', () => {
    const ascii = 'sk-or-v1-ABC_123.~/+=';
    expect(mapRussianLayout(ascii)).toBe(ascii);
  });

  it('leaves unmapped Cyrillic letters (ё) as-is so validation can flag them', () => {
    expect(mapRussianLayout('ё')).toBe('ё');
  });
});
