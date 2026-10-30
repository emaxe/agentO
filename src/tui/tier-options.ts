/**
 * Tier choices for the profile wizards.
 *
 * A multi-model profile may use each tier at most once and must contain a
 * `base` tier. Offering a used tier or "no tier" in that situation produced an
 * option that only failed later, at save time, with a validation error. The
 * option list is derived here so the wizard and the editor cannot disagree.
 */
import type { ModelTier } from '../config/schema.js';

export const TIERS: readonly ModelTier[] = ['small', 'base', 'smart'];

export interface TierOption {
  tier?: ModelTier;
  label: string;
}

/** Tiers already used by models in the profile being edited. */
export function usedTiersOf(models: readonly { tier?: ModelTier }[]): Set<ModelTier> {
  return new Set(
    models.map((model) => model.tier).filter((tier): tier is ModelTier => Boolean(tier)),
  );
}

/**
 * @param usedTiers tiers already assigned in this profile
 * @param allowSkip whether "no tier" is a valid choice — only for the first
 *   (and therefore single) model of a profile
 */
export function tierOptions(usedTiers: Set<ModelTier>, allowSkip: boolean): TierOption[] {
  const options: TierOption[] = TIERS.filter((tier) => !usedTiers.has(tier)).map((tier) => ({
    tier,
    label: tier,
  }));
  if (allowSkip) {
    options.push({ tier: undefined, label: 'skip (single-model profile)' });
  }
  return options;
}

/** Defaults to `base` — the tier a multi-model profile cannot do without. */
export function defaultTierCursor(options: readonly TierOption[]): number {
  const base = options.findIndex((option) => option.tier === 'base');
  return base >= 0 ? base : 0;
}
