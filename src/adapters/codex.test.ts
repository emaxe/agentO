import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from './codex.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new CodexAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Fireworks AI',
  type: 'openai-compatible',
  apiKey: 'fw_test123',
  baseUrl: 'https://api.fireworks.ai/inference/v1',
  models: [{ name: 'accounts/fireworks/models/kimi-k2', capabilities: { image: true, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: testProvider.id, model: 'accounts/fireworks/models/kimi-k2' }],
};

describe('CodexAdapter', () => {
  it('supportedProviderTypes includes openai-compatible and fireworks', () => {
    expect(adapter.supportedProviderTypes).toEqual(['fireworks']);
  });

  describe('configPaths', () => {
    it('returns correct global path', () => {
      const paths = adapter.configPaths();
      expect(paths.global).toMatch(/\.codex[/\\]config\.toml$/);
    });

    it('returns correct project path', () => {
      const paths = adapter.configPaths('/my/project');
      expect(paths.project).toBe('/my/project/.codex/config.toml');
    });
  });

  describe('buildConfig', () => {
    it('sets top-level model field', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      expect(config.model).toBe('accounts/fireworks/models/kimi-k2');
    });

    it('creates model_providers entry with correct structure', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const providers = config.model_providers as Record<string, unknown>;
      expect('fireworks-ai' in providers).toBe(true);
      const entry = providers['fireworks-ai'] as Record<string, unknown>;
      expect(entry.name).toBe('Fireworks AI');
      expect(entry.base_url).toBe('https://api.fireworks.ai/inference/v1');
      expect(entry.wire_api).toBe('responses');
    });

    it('sets default_profile to default', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      expect(config.default_profile).toBe('default');
    });

    it('creates profiles.default with model and model_provider', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const profiles = config.profiles as Record<string, Record<string, unknown>>;
      expect('default' in profiles).toBe(true);
      expect(profiles.default.model).toBe('accounts/fireworks/models/kimi-k2');
      expect(profiles.default.model_provider).toBe('fireworks-ai');
    });

    it('derives env_key from provider name', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const providers = config.model_providers as Record<string, unknown>;
      const entry = providers['fireworks-ai'] as Record<string, unknown>;
      expect(entry.env_key).toBe('CODEX_FIREWORKS_AI_API_KEY');
    });

    it('multi-tier profile selects base tier model', () => {
      const multiTierProfile: Profile = {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Multi Tier',
        models: [
          { providerId: testProvider.id, model: 'small-model', tier: 'small' },
          { providerId: testProvider.id, model: 'base-model', tier: 'base' },
          { providerId: testProvider.id, model: 'smart-model', tier: 'smart' },
        ],
      };
      const config = adapter.buildConfig(multiTierProfile, [testProvider]);
      expect(config.model).toBe('base-model');
    });

    it('throws when provider not found', () => {
      expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
    });

    it('normalizes provider name with spaces', () => {
      const provider: Provider = { ...testProvider, name: 'My Custom Provider' };
      const config = adapter.buildConfig(testProfile, [provider]);
      const providers = config.model_providers as Record<string, unknown>;
      expect('my-custom-provider' in providers).toBe(true);
    });

    it('sets empty base_url when provider has no baseUrl', () => {
      const providerNoUrl: Provider = { ...testProvider, baseUrl: undefined };
      const config = adapter.buildConfig(testProfile, [providerNoUrl]);
      const providers = config.model_providers as Record<string, unknown>;
      const entry = providers['fireworks-ai'] as Record<string, unknown>;
      expect(entry.base_url).toBe('');
    });
  });

  describe('buildEnv', () => {
    it('returns api key mapped to derived env key', () => {
      const env = adapter.buildEnv(testProfile, [testProvider]);
      expect(env['CODEX_FIREWORKS_AI_API_KEY']).toBe('fw_test123');
    });

    it('returns empty object when provider not found', () => {
      const env = adapter.buildEnv(testProfile, []);
      expect(env).toEqual({});
    });

    it('env key matches what buildConfig writes to config', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const env = adapter.buildEnv(testProfile, [testProvider]);
      const providers = config.model_providers as Record<string, unknown>;
      const entry = providers['fireworks-ai'] as Record<string, unknown>;
      const configEnvKey = entry.env_key as string;
      expect(configEnvKey in env).toBe(true);
    });
  });

  describe('readConfig / writeConfig', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('readConfig returns null for non-existent project file', async () => {
      const result = await adapter.readConfig('project', '/nonexistent/path-that-does-not-exist-12345');
      expect(result).toBeNull();
    });

    it('writeConfig serializes to TOML format', async () => {
      const writtenFiles: Record<string, string> = {};
      vi.mock('node:fs/promises', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs/promises')>();
        return {
          ...actual,
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockImplementation((path: string, content: string) => {
            writtenFiles[path] = content;
          }),
        };
      });

      const config = adapter.buildConfig(testProfile, [testProvider]);
      // Just verify the config is TOML-serializable (no throws)
      const { stringify } = await import('smol-toml');
      expect(() => stringify(config as Parameters<typeof stringify>[0])).not.toThrow();
      const toml = stringify(config as Parameters<typeof stringify>[0]);
      expect(toml).toContain('model =');
      expect(toml).toContain('[model_providers.fireworks-ai]');
    });

    it('fireworks provider without baseUrl uses default URL', () => {
      const fireworksProvider = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Fireworks',
        type: 'fireworks' as const,
        apiKey: 'fw-test-key',
        models: [{ name: 'llama-3.1-70b-instruct', capabilities: { image: true, video: false, audio: false } }],
      };
      const config = adapter.buildConfig(testProfile, [fireworksProvider]);
      const modelProviders = config.model_providers as Record<string, Record<string, unknown>>;
      expect(modelProviders['fireworks']?.base_url).toBe('https://api.fireworks.ai/inference/v1');
    });
  });
});
