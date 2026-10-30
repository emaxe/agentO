import { describe, expect, it } from 'vitest';
import { defaultTierCursor, tierOptions, usedTiersOf } from './tier-options.js';

describe('tierOptions', () => {
  it('offers every tier plus skip for the first model', () => {
    const options = tierOptions(new Set(), true);
    expect(options.map((o) => o.tier)).toEqual(['small', 'base', 'smart', undefined]);
  });

  it('hides used tiers and never offers skip once a model exists', () => {
    const options = tierOptions(new Set(['small']), false);
    expect(options.map((o) => o.tier)).toEqual(['base', 'smart']);
  });

  it('defaults the cursor to base', () => {
    expect(defaultTierCursor(tierOptions(new Set(['small']), false))).toBe(0);
    expect(defaultTierCursor(tierOptions(new Set(), true))).toBe(1);
  });

  it('collects only defined tiers', () => {
    expect([...usedTiersOf([{ tier: 'base' }, {}, { tier: 'smart' }])]).toEqual(['base', 'smart']);
  });
});
