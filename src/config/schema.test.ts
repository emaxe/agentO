import { describe, it, expect } from 'vitest';
import {
  AgentOConfigSchema,
  ProviderSchema,
  resolveCustomApiUrl,
  type Provider,
} from './schema.js';

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
    expect(resolveCustomApiUrl(baseProvider, 'responses')).toBe(
      'https://opencode.ai/zen/v1/responses',
    );
  });

  it('anthropic mode never re-introduces a doubled /v1/v1 segment when baseUrl ends in /v1', () => {
    // The form stores what the user typed, so a baseUrl may legitimately carry /v1.
    // Anthropic clients append /v1/messages themselves, so the suffix must be dropped.
    const parsed = ProviderSchema.parse({ ...baseProvider, baseUrl: 'https://opencode.ai/zen/v1' });
    const resolved = resolveCustomApiUrl(parsed, 'anthropic');
    expect(resolved).toBe('https://opencode.ai/zen');
    expect(resolved).not.toMatch(/\/v1\/v1/);
  });

  it('openai mode adds exactly one /v1 even when baseUrl ends in /v1', () => {
    const parsed = ProviderSchema.parse({ ...baseProvider, baseUrl: 'https://opencode.ai/zen/v1' });
    const resolved = resolveCustomApiUrl(parsed, 'openai');
    expect(resolved).toBe('https://opencode.ai/zen/v1');
    expect(resolved).not.toMatch(/\/v1\/v1/);
  });

  it('ignores a trailing slash and a pasted full responses endpoint', () => {
    const withSlash = ProviderSchema.parse({
      ...baseProvider,
      baseUrl: 'https://opencode.ai/zen/v1/',
    });
    expect(resolveCustomApiUrl(withSlash, 'openai')).toBe('https://opencode.ai/zen/v1');

    const withEndpoint = ProviderSchema.parse({
      ...baseProvider,
      baseUrl: 'https://opencode.ai/zen/v1/responses',
    });
    expect(resolveCustomApiUrl(withEndpoint, 'responses')).toBe(
      'https://opencode.ai/zen/v1/responses',
    );
    expect(resolveCustomApiUrl(withEndpoint, 'openai')).toBe('https://opencode.ai/zen/v1');
  });
});

// A custom-api baseUrl used to be rewritten on save: a trailing /v1 was silently
// dropped for every mode. The form therefore showed a value the user never typed,
// and "Test API" (which probes the stored baseUrl) hit /models instead of
// /v1/models — the request failed until /v1 was typed in again. Storage now keeps
// the value verbatim and resolveCustomApiUrl derives each mode's path itself.
describe('ProviderSchema custom-api baseUrl round-trip', () => {
  const provider = {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Custom',
    type: 'custom-api' as const,
    apiKey: 'sk-custom',
    customApiModes: { openai: true, anthropic: false, responses: false },
    models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }],
  };

  it('keeps a user-entered /v1 exactly as typed', () => {
    expect(
      ProviderSchema.parse({ ...provider, baseUrl: 'https://api.example.com/v1' }).baseUrl,
    ).toBe('https://api.example.com/v1');
  });

  it('keeps a bare host untouched', () => {
    expect(ProviderSchema.parse({ ...provider, baseUrl: 'https://api.example.com' }).baseUrl).toBe(
      'https://api.example.com',
    );
  });
});

// zod 4 tightened `.uuid()` to enforce RFC 9562 version/variant bits. Every id in
// a stored config was produced by randomUUID() and is a valid v4, but configs are
// hand-edited often enough that silently rejecting a well-formed-but-not-v4 id on
// read would lock users out of their own providers. `z.guid()` keeps zod 3's
// permissive 8-4-4-4-12 check.
describe('id validation stays permissive across the zod 4 upgrade', () => {
  const provider = {
    id: '00000000-0000-0000-0000-0000000000e2',
    name: 'Hand written',
    type: 'openai-compatible' as const,
    apiKey: 'sk-x',
    baseUrl: 'https://api.example.com/v1',
    models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }],
  };

  it('accepts an id that is well-formed but not an RFC v4 UUID', () => {
    expect(ProviderSchema.parse(provider).id).toBe(provider.id);
  });

  it('still rejects a malformed id', () => {
    expect(ProviderSchema.safeParse({ ...provider, id: 'not-an-id' }).success).toBe(false);
  });
});

// zod 4 changed `.default()` to short-circuit instead of parsing the fallback;
// the schemas use `.prefault()` so nested field defaults keep filling in.
describe('nested defaults survive the zod 4 upgrade', () => {
  it('fills model capabilities when the object is omitted', () => {
    const parsed = ProviderSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'P',
      type: 'openai-compatible',
      apiKey: 'sk-x',
      models: [{ name: 'm' }],
    });
    expect(parsed.models[0]?.capabilities).toEqual({ image: true, video: false, audio: false });
  });

  it('fills settings defaults for an empty config', () => {
    expect(AgentOConfigSchema.parse({}).settings).toEqual({
      defaultLaunchMode: 'child',
      defaultConfigScope: 'project',
      mergeAgentConfigs: true,
    });
  });
});
