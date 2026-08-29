import type { Profile, ProfileModel, Provider } from '../config/schema.js';

export interface ResolvedBaseModel {
  /** The profile entry marked `tier: 'base'`, or the first one when untiered. */
  model: ProfileModel;
  /** The provider that entry points at. */
  provider: Provider;
}

/**
 * Resolves the profile's base model together with its provider.
 *
 * Every adapter needs the same pair and used to compute it inline, which let the
 * failure modes drift apart: some threw when the provider was missing, others
 * quietly returned an empty config and launched the agent with no provider
 * configuration at all. Throwing is the only safe answer — a profile pointing at
 * a deleted provider cannot produce a working launch, and the launcher's
 * compatibility check relies on the throw to hide the agent from the user.
 *
 * @throws when the profile has no models, or its base model references a
 * provider that is not in `providers`.
 */
export function resolveBaseModel(profile: Profile, providers: Provider[]): ResolvedBaseModel {
  const model = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
  if (!model) throw new Error(`Profile "${profile.name}" has no models`);

  const provider = providers.find((p) => p.id === model.providerId);
  if (!provider) {
    throw new Error(`Provider not found for id: ${model.providerId} (profile "${profile.name}")`);
  }

  return { model, provider };
}
