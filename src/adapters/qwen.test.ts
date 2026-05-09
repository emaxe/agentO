import { describe, it, expect } from 'vitest';
import { QwenAdapter } from './qwen.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new QwenAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Fireworks AI',
  type: 'openai-compatible',
  apiKey: 'fw_test123',
  baseUrl: 'http://188.132.197.214:20128/v1',
  models: ['accounts/fireworks/models/kimi-k2'],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: testProvider.id, model: 'accounts/fireworks/models/kimi-k2' }],
};

describe('QwenAdapter', () => {
  describe('configPaths', () => {
    it('returns correct global path', () => {
      const paths = adapter.configPaths();
      expect(paths.global).toMatch(/\.qwen[/\\]settings\.json$/);
      expect(paths.global).toContain('.qwen');
    });

    it('returns correct project path', () => {
      const paths = adapter.configPaths('/my/project');
      expect(paths.project).toBe('/my/project/.qwen/settings.json');
    });
  });

  describe('buildConfig', () => {
    it('sets model.name to bare model name (no prefix)', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const model = config.model as { name: string };
      expect(model.name).toBe('accounts/fireworks/models/kimi-k2');
    });

    it('derives env key correctly from baseUrl', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const env = config.env as Record<string, string>;
      expect('QWEN_CUSTOM_API_KEY_OPENAI_HTTP_188_132_197_214_20128_V1' in env).toBe(true);
      expect(env['QWEN_CUSTOM_API_KEY_OPENAI_HTTP_188_132_197_214_20128_V1']).toBe('fw_test123');
    });

    it('uses "openai" as modelProviders key for openai-compatible providers, bare model id (no prefix)', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const mp = config.modelProviders as Record<string, unknown[]>;
      expect('openai' in mp).toBe(true);
      expect('fireworks-ai' in mp).toBe(false);
      const entries = mp['openai']!;
      expect(entries).toHaveLength(1);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry.id).toBe('accounts/fireworks/models/kimi-k2');
      expect(entry.name).toBe('accounts/fireworks/models/kimi-k2');
      expect(entry.baseUrl).toBe('http://188.132.197.214:20128/v1');
      expect(entry.envKey).toBe('QWEN_CUSTOM_API_KEY_OPENAI_HTTP_188_132_197_214_20128_V1');
    });

    it('sets security.auth.selectedType to "openai" (protocol constant)', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const security = config.security as { auth: { selectedType: string } };
      expect(security.auth.selectedType).toBe('openai');
    });

    it('sets $version to 4', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      expect(config.$version).toBe(4);
    });

    it('multi-tier profile selects base tier model (bare name)', () => {
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
      const model = config.model as { name: string };
      expect(model.name).toBe('base-model');
    });

    it('groups multiple models from same provider under "openai" key', () => {
      const multiModelProfile: Profile = {
        id: '00000000-0000-0000-0000-000000000004',
        name: 'Multi Model',
        models: [
          { providerId: testProvider.id, model: 'model-a', tier: 'small' },
          { providerId: testProvider.id, model: 'model-b', tier: 'base' },
        ],
      };
      const config = adapter.buildConfig(multiModelProfile, [testProvider]);
      const mp = config.modelProviders as Record<string, unknown[]>;
      expect(mp['openai']).toHaveLength(2);
    });

    it('throws when provider not found', () => {
      expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
    });

    it('throws when provider type is anthropic', () => {
      const anthropicProvider: Provider = { ...testProvider, type: 'anthropic' };
      expect(() => adapter.buildConfig(testProfile, [anthropicProvider])).toThrow('does not support Anthropic');
    });

    it('throws when provider has no baseUrl', () => {
      const providerNoUrl: Provider = { ...testProvider, baseUrl: undefined };
      expect(() => adapter.buildConfig(testProfile, [providerNoUrl])).toThrow('requires a baseUrl');
    });
  });

  describe('env key derivation edge cases', () => {
    it('handles URL with https and path', () => {
      const provider: Provider = { ...testProvider, baseUrl: 'https://api.fireworks.ai/inference/v1' };
      const config = adapter.buildConfig({ ...testProfile, models: [{ ...testProfile.models[0]!, providerId: provider.id }] }, [provider]);
      const env = config.env as Record<string, string>;
      expect('QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_API_FIREWORKS_AI_INFERENCE_V1' in env).toBe(true);
    });

    it('collapses consecutive underscores from special chars', () => {
      const provider: Provider = { ...testProvider, baseUrl: 'https://api.example.com/v1' };
      const config = adapter.buildConfig({ ...testProfile, models: [{ ...testProfile.models[0]!, providerId: provider.id }] }, [provider]);
      const env = config.env as Record<string, string>;
      // Should not have double underscores
      const key = Object.keys(env)[0]!;
      expect(key).not.toMatch(/__[_]+/);
    });
  });
});
