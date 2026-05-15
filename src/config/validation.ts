/**
 * Domain-level validation for AgentO providers and profiles.
 *
 * These checks go beyond Zod schema shape validation to enforce business rules:
 * - Provider name uniqueness
 * - responses-compatible and custom-api require baseUrl (openai-compatible defaults to https://api.openai.com/v1)
 * - Profile model providerId references must resolve to existing providers
 * - Multi-model profiles require a tier on every model
 * - Multi-model profiles must have at least one model with tier=base
 * - Multi-model profiles must not have duplicate tiers
 */
import { ProviderTypeSchema } from './schema.js';
import type { Provider, Profile, ProfileModel } from './schema.js';

/** Pre-validation provider input — `type` is `string` because domain validation performs the enum check. */
export type ProviderInput = Omit<Provider, 'id' | 'type'> & { type: string };
export type ProfileInput = Omit<Profile, 'id'>;

/**
 * Validates provider domain rules.
 * @param data - Input data (without `id`). `type` is accepted as `string`; this function validates it against `ProviderTypeSchema`.
 * @param existingProviders - Current list of providers from config.
 * @param selfId - When updating, pass the existing provider's id to skip self-name check.
 * @throws Error with a descriptive message on first violation.
 */
export function validateProvider(
  data: ProviderInput,
  existingProviders: Provider[],
  selfId?: string,
): void {
  if (!data.name || !data.name.trim()) {
    throw new Error('Provider name is required.');
  }

  if (!data.apiKey || !data.apiKey.trim()) {
    throw new Error('Provider API key is required.');
  }

  // type must be a known ProviderType
  const typeResult = ProviderTypeSchema.safeParse(data.type);
  if (!typeResult.success) {
    throw new Error(
      `Invalid provider type: "${data.type}". Supported: ${ProviderTypeSchema.options.join(', ')}`,
    );
  }

  // Types that require baseUrl (openai-compatible defaults to https://api.openai.com/v1)
  const baseUrlRequiredTypes = ['responses-compatible', 'custom-api'] as const;
  if (baseUrlRequiredTypes.includes(data.type as (typeof baseUrlRequiredTypes)[number]) && !data.baseUrl) {
    throw new Error(`Provider type "${data.type}" requires a baseUrl.`);
  }

  // custom-api requires at least one enabled API mode
  if (data.type === 'custom-api') {
    const modes = (data as ProviderInput & { customApiModes?: { openai?: boolean; anthropic?: boolean; responses?: boolean } }).customApiModes;
    if (!modes || (!modes.openai && !modes.anthropic && !modes.responses)) {
      throw new Error('Provider type "custom-api" requires at least one API mode (openai, anthropic, or responses) to be enabled.');
    }
  }

  // name must be unique (skip self when updating)
  const duplicate = existingProviders.find(
    (p) => p.name === data.name && p.id !== selfId,
  );
  if (duplicate) {
    throw new Error(`Provider name "${data.name}" is already in use.`);
  }

  // models must be non-empty
  if (!data.models || data.models.length === 0) {
    throw new Error('Provider must have at least one model.');
  }
}

/**
 * Validates profile domain rules.
 * @param data - Input data (without `id`).
 * @param existingProfiles - Current list of profiles from config.
 * @param existingProviders - Current list of providers from config (for reference checks).
 * @param selfId - When updating, pass the existing profile's id to skip self-name check.
 * @throws Error with a descriptive message on first violation.
 */
export function validateProfile(
  data: ProfileInput,
  existingProfiles: Profile[],
  existingProviders: Provider[],
  selfId?: string,
): void {
  if (!data.name || !data.name.trim()) {
    throw new Error('Profile name is required.');
  }

  // name must be unique (skip self when updating)
  const duplicate = existingProfiles.find(
    (p) => p.name === data.name && p.id !== selfId,
  );
  if (duplicate) {
    throw new Error(`Profile name "${data.name}" is already in use.`);
  }

  // models must be non-empty
  if (!data.models || data.models.length === 0) {
    throw new Error('Profile must have at least one model.');
  }

  // every providerId must reference an existing provider
  const providerIds = new Set(existingProviders.map((p) => p.id));
  for (const m of data.models) {
    if (!providerIds.has(m.providerId)) {
      throw new Error(`Profile references unknown providerId: "${m.providerId}".`);
    }
  }

  // all models in a profile must belong to the same provider
  const firstProviderId = data.models[0]?.providerId;
  for (const m of data.models) {
    if (m.providerId !== firstProviderId) {
      const firstProvider = existingProviders.find((p) => p.id === firstProviderId);
      const otherProvider = existingProviders.find((p) => p.id === m.providerId);
      throw new Error(
        `Profile models must all belong to the same provider. ` +
        `Current provider: "${firstProvider?.name ?? firstProviderId}", ` +
        `conflicting model "${m.model}" belongs to "${otherProvider?.name ?? m.providerId}".`,
      );
    }
  }

  // multi-model: every model must have a tier
  if (data.models.length > 1) {
    const missingTier = data.models.find((m: ProfileModel) => !m.tier);
    if (missingTier) {
      throw new Error(
        `Multi-model profile: every model must have a tier (small|base|smart). ` +
        `Model "${missingTier.model}" (provider ${missingTier.providerId}) is missing a tier.`,
      );
    }

    // multi-model: no duplicate tiers
    const tiers = data.models.map((m: ProfileModel) => m.tier);
    const tierSet = new Set(tiers);
    if (tierSet.size !== tiers.length) {
      throw new Error(
        'Multi-model profile: duplicate tiers are not allowed. Each model must have a unique tier.',
      );
    }

    // multi-model: must have at least one model with tier=base
    if (!data.models.some((m: ProfileModel) => m.tier === 'base')) {
      throw new Error(
        'Multi-model profile: at least one model must have tier=base.',
      );
    }
  }
}
