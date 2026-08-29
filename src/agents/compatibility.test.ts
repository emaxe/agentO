/**
 * The launch gate: which agents can actually run a given profile.
 *
 * This used to be two divergent copies — one in the TUI wizard, one in
 * `agento launch` — and both only called `buildConfig`. For the env-only
 * adapters that method returns `{}` without looking at the provider at all, so a
 * profile pointing at a deleted provider passed the check and launched the agent
 * with no provider configuration whatsoever.
 */
import { describe, it, expect } from 'vitest';
import { canRunProfile, describeIncompatibility } from './compatibility.js';
import { listAgents } from './registry.js';
import type { Profile, Provider } from '../config/schema.js';

const agents = listAgents({ dev: true });
const adapterFor = (id: string) => agents.find((a) => a.id === id)!.adapter;

const PROVIDER_ID = '00000000-0000-0000-0000-000000000001';

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: PROVIDER_ID,
    name: 'P',
    type: 'openai-compatible',
    apiKey: 'sk-x',
    baseUrl: 'https://api.example.com/v1',
    models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }],
    ...overrides,
  };
}

const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'P',
  models: [{ providerId: PROVIDER_ID, model: 'm' }],
};

describe('describeIncompatibility', () => {
  it('accepts a profile every adapter of that type can run', () => {
    expect(describeIncompatibility(adapterFor('qwen'), profile, [provider()])).toBeUndefined();
  });

  it('names the unsupported provider type', () => {
    const p = provider({ type: 'anthropic-compatible', baseUrl: undefined });
    const reason = describeIncompatibility(adapterFor('qwen'), profile, [p]);
    expect(reason).toContain('does not support provider type(s): anthropic-compatible');
  });

  it('reports the adapter error for a custom-api provider with no mode enabled', () => {
    const p = provider({
      type: 'custom-api',
      baseUrl: 'https://gw.example.com',
      customApiModes: { openai: false, anthropic: false, responses: false },
    });
    // custom-api is declared supported by every adapter, so only building can reject it.
    expect(describeIncompatibility(adapterFor('claude-code'), profile, [p])).toMatch(/custom-api/);
  });

  it.each(['copilot', 'goose', 'pi', 'kimi'])(
    'catches a deleted provider for the env-only adapter %s',
    (id) => {
      // buildConfig returns {} for these; only buildEnv can notice.
      expect(describeIncompatibility(adapterFor(id), profile, [])).toMatch(/Provider not found/);
    },
  );

  it.each(['copilot', 'goose', 'pi'])(
    'catches a modeless custom-api provider for the env-only adapter %s',
    (id) => {
      const p = provider({
        type: 'custom-api',
        baseUrl: 'https://gw.example.com',
        customApiModes: { openai: false, anthropic: false, responses: false },
      });
      expect(describeIncompatibility(adapterFor(id), profile, [p])).toBeDefined();
    },
  );

  it('rejects Claude Code when tiers span two providers', () => {
    const a = provider();
    const b = provider({ id: '00000000-0000-0000-0000-000000000003', name: 'Q' });
    const mixed: Profile = {
      ...profile,
      models: [
        { providerId: a.id, model: 'm', tier: 'base' },
        { providerId: b.id, model: 'm2', tier: 'small' },
      ],
    };
    expect(describeIncompatibility(adapterFor('claude-code'), mixed, [a, b]))
      .toContain('only one provider per profile');
  });
});

describe('canRunProfile', () => {
  it('mirrors describeIncompatibility', () => {
    expect(canRunProfile(adapterFor('qwen'), profile, [provider()])).toBe(true);
    expect(canRunProfile(adapterFor('qwen'), profile, [])).toBe(false);
  });

  it('never offers an agent that would throw at launch', () => {
    // The invariant the wizard depends on: anything reported runnable must
    // survive both halves of the build.
    for (const { adapter } of agents) {
      if (!canRunProfile(adapter, profile, [provider()])) continue;
      expect(() => {
        adapter.buildConfig(profile, [provider()]);
        adapter.buildEnv?.(profile, [provider()]);
      }).not.toThrow();
    }
  });
});
