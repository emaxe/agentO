import { describe, it, expect } from 'vitest';
import { ProviderSchema, resolveCustomApiUrl, type Provider } from './schema.js';

// Regression coverage for two related custom-api URL bugs:
//
// 1. Anthropic mode used to append `/v1` even though downstream clients (Claude
//    Code / Anthropic SDK / Vercel @ai-sdk/anthropic) already append `/v1/messages`
//    themselves, producing `.../v1/v1/messages`.
// 2. Openai mode used to append nothing, even though downstream clients (Qwen CLI,
//    OpenCode/Kilo/Copilot in openai mode, Codex) never insert a version segment
//    themselves and only append the endpoint path — so a bare host produced 404s
//    (e.g. Qwen hit the opencode.ai website's 404 page instead of its API).
//
// See src/config/defaults.ts (DEFAULT_BASE_URLS vs DEFAULT_ANTHROPIC_BASE_URLS) for
// the two opposite conventions this function has to straddle.
describe('resolveCustomApiUrl', () => {
  const baseProvider: Provider = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Custom',
    type: 'custom-api',
    apiKey: 'sk-custom',
    baseUrl: 'https://opencode.ai/zen',
    customApiModes: { openai: true, anthropic: true, responses: true },
    models: [{ name: 'big-pickle', capabilities: { image: true, video: false, audio: false } }],
  };

  it('anthropic mode returns the bare baseUrl (no /v1 suffix)', () => {
    expect(resolveCustomApiUrl(baseProvider, 'anthropic')).toBe('https://opencode.ai/zen');
  });

  it('openai mode appends /v1', () => {
    expect(resolveCustomApiUrl(baseProvider, 'openai')).toBe('https://opencode.ai/zen/v1');
  });

  it('responses mode appends /v1/responses', () => {
    expect(resolveCustomApiUrl(baseProvider, 'responses')).toBe('https://opencode.ai/zen/v1/responses');
  });

  it('anthropic mode never re-introduces a doubled /v1/v1 segment when baseUrl already ends in /v1', () => {
    // ProviderSchema strips a trailing /v1 from custom-api baseUrl on parse (schema.ts:50-51),
    // so a user-entered "https://opencode.ai/zen/v1" normalizes to "https://opencode.ai/zen"
    // before resolveCustomApiUrl ever sees it.
    const parsed = ProviderSchema.parse({ ...baseProvider, baseUrl: 'https://opencode.ai/zen/v1' });
    expect(parsed.baseUrl).toBe('https://opencode.ai/zen');
    const resolved = resolveCustomApiUrl(parsed, 'anthropic');
    expect(resolved).toBe('https://opencode.ai/zen');
    expect(resolved).not.toMatch(/\/v1\/v1/);
  });

  it('openai mode adds exactly one /v1 even when baseUrl already ends in /v1 pre-normalization', () => {
    const parsed = ProviderSchema.parse({ ...baseProvider, baseUrl: 'https://opencode.ai/zen/v1' });
    const resolved = resolveCustomApiUrl(parsed, 'openai');
    expect(resolved).toBe('https://opencode.ai/zen/v1');
    expect(resolved).not.toMatch(/\/v1\/v1/);
  });
});
