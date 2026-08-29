import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

/**
 * Reports why an adapter cannot run a profile, or `undefined` when it can.
 *
 * The declared `supportedProviderTypes` is only the first gate — an adapter can
 * still reject a profile it nominally supports (Claude Code with tiers on two
 * providers, a `custom-api` provider with no wire protocol enabled, a model
 * pointing at a deleted provider). The only reliable check is to build the
 * config the launch would build.
 *
 * Both halves must be exercised: for the env-only adapters (copilot, goose, pi,
 * kimi) `buildConfig` returns `{}` and all the real work — including every
 * validation — happens in `buildEnv`. Checking `buildConfig` alone reported
 * those agents as compatible and then threw at launch time, or worse, launched
 * them with no provider configuration at all.
 */
export function describeIncompatibility(
  adapter: AgentAdapter,
  profile: Profile,
  providers: Provider[],
): string | undefined {
  const types = new Set<string>();
  for (const model of profile.models) {
    const provider = providers.find((p) => p.id === model.providerId);
    if (provider) types.add(provider.type);
  }

  const unsupported = [...types].filter(
    (type) => !(adapter.supportedProviderTypes as readonly string[]).includes(type),
  );
  if (unsupported.length > 0) {
    return `${adapter.displayName} does not support provider type(s): ${unsupported.join(', ')}. `
      + `Supported: ${adapter.supportedProviderTypes.join(', ')}`;
  }

  try {
    adapter.buildConfig(profile, providers);
    adapter.buildEnv?.(profile, providers);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  return undefined;
}

/** Convenience wrapper around {@link describeIncompatibility}. */
export function canRunProfile(
  adapter: AgentAdapter,
  profile: Profile,
  providers: Provider[],
): boolean {
  return describeIncompatibility(adapter, profile, providers) === undefined;
}
