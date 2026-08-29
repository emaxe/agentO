/**
 * Covers the gate that decides which agents the launch wizard offers.
 *
 * Getting this wrong is user-visible in both directions: too strict and a usable
 * agent disappears from the list, too loose and the user picks an agent that
 * throws the moment it tries to build a config.
 */
import { describe, it, expect } from 'vitest';
import { getCompatibleAgents } from './useLaunchWizard.js';
import { listAgents } from '../../agents/registry.js';
import type { Profile, Provider } from '../../config/schema.js';

const agents = listAgents({ dev: true });

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

function profile(models: Profile['models']): Profile {
  return { id: '00000000-0000-0000-0000-000000000002', name: 'P', models };
}

const single = profile([{ providerId: PROVIDER_ID, model: 'm' }]);

describe('getCompatibleAgents', () => {
  it('offers every agent that declares support for the profile provider type', () => {
    const p = provider({ type: 'openai-compatible' });
    const ids = getCompatibleAgents(agents, single, [p]).map((a) => a.id);

    const declared = agents
      .filter((a) => (a.adapter.supportedProviderTypes as readonly string[]).includes('openai-compatible'))
      .map((a) => a.id);
    expect(ids).toEqual(declared);
  });

  it('hides agents that do not declare the provider type', () => {
    const p = provider({ type: 'anthropic-compatible', baseUrl: undefined });
    const ids = getCompatibleAgents(agents, single, [p]).map((a) => a.id);

    // qwen and codex are the two adapters without anthropic-compatible.
    expect(ids).not.toContain('qwen');
    expect(ids).not.toContain('codex');
    expect(ids).toContain('claude-code');
  });

  it('hides an agent whose adapter cannot build a config, even when the type matches', () => {
    // custom-api is declared supported everywhere, but a provider with no
    // enabled mode cannot produce a usable config for any of them.
    const p = provider({ type: 'custom-api', baseUrl: 'https://gw.example.com', customApiModes: { openai: false, anthropic: false, responses: false } });
    expect(getCompatibleAgents(agents, single, [p])).toEqual([]);
  });

  it('offers agents again once the custom-api provider enables a mode', () => {
    const p = provider({ type: 'custom-api', baseUrl: 'https://gw.example.com', customApiModes: { openai: true, anthropic: false, responses: false } });
    const ids = getCompatibleAgents(agents, single, [p]).map((a) => a.id);
    expect(ids).toContain('qwen');
    expect(ids).toContain('claude-code');
  });

  it('hides Claude Code when tiers span two providers', () => {
    const a = provider({ id: PROVIDER_ID, type: 'openai-compatible' });
    const b = provider({ id: '00000000-0000-0000-0000-000000000003', name: 'Q', type: 'openai-compatible' });
    const mixed = profile([
      { providerId: a.id, model: 'm', tier: 'base' },
      { providerId: b.id, model: 'm2', tier: 'small' },
    ]);

    // The type check passes for both providers, so only buildConfig can reject it.
    expect(getCompatibleAgents(agents, mixed, [a, b]).map((x) => x.id)).not.toContain('claude-code');
  });

  it('requires every provider in the profile to be supported, not just the first', () => {
    const openai = provider({ id: PROVIDER_ID, type: 'openai-compatible' });
    const anthropic = provider({
      id: '00000000-0000-0000-0000-000000000004',
      name: 'A',
      type: 'anthropic-compatible',
      baseUrl: undefined,
    });
    const mixed = profile([
      { providerId: openai.id, model: 'm', tier: 'base' },
      { providerId: anthropic.id, model: 'm2', tier: 'small' },
    ]);

    // qwen supports openai-compatible but not anthropic-compatible, so the
    // second model must disqualify it.
    expect(getCompatibleAgents(agents, mixed, [openai, anthropic]).map((a) => a.id)).not.toContain('qwen');
  });

  it('ignores models whose provider no longer exists', () => {
    const orphan = profile([{ providerId: '00000000-0000-0000-0000-0000000000ff', model: 'm' }]);
    // No provider types collected, so nothing is filtered out by the type gate;
    // adapters that throw on the missing provider are still dropped.
    expect(getCompatibleAgents(agents, orphan, [])).toEqual([]);
  });
});
