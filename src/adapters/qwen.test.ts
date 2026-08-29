import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QwenAdapter } from './qwen.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new QwenAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Fireworks AI',
  type: 'openai-compatible',
  apiKey: 'fw_test123',
  baseUrl: 'http://188.132.197.214:20128/v1',
  models: [{ name: 'accounts/fireworks/models/kimi-k2', capabilities: { image: true, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: testProvider.id, model: 'accounts/fireworks/models/kimi-k2' }],
};

describe('QwenAdapter', () => {
  it('supportedProviderTypes includes openai-compatible, fireworks and openrouter', () => {
    expect(adapter.supportedProviderTypes).toEqual(['openai-compatible', 'fireworks', 'openrouter', 'custom-api']);
  });

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
      const anthropicProvider: Provider = { ...testProvider, type: 'anthropic-compatible' };
      expect(() => adapter.buildConfig(testProfile, [anthropicProvider])).toThrow('does not support Anthropic');
    });

    it('throws when custom-api provider lacks openai mode', () => {
      const providerNoMode: Provider = { ...testProvider, type: 'custom-api', baseUrl: undefined, customApiModes: { openai: false, anthropic: false, responses: false } };
      expect(() => adapter.buildConfig(testProfile, [providerNoMode])).toThrow('requires openai mode');
    });

    it('passes model capabilities to generationConfig.modalities', () => {
      const providerWithCaps: Provider = {
        ...testProvider,
        models: [{ name: 'accounts/fireworks/models/kimi-k2', capabilities: { image: true, video: true, audio: false } }],
      };
      const config = adapter.buildConfig(testProfile, [providerWithCaps]);
      const mp = config.modelProviders as Record<string, Array<Record<string, unknown>>>;
      const entry = mp['openai']![0]!;
      const gc = entry.generationConfig as { modalities: { image: boolean; video: boolean; audio: boolean } };
      expect(gc.modalities.image).toBe(true);
      expect(gc.modalities.video).toBe(true);
      expect(gc.modalities.audio).toBe(false);
    });

    it('defaults capabilities when model not found in provider', () => {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      const mp = config.modelProviders as Record<string, Array<Record<string, unknown>>>;
      const entry = mp['openai']![0]!;
      const gc = entry.generationConfig as { modalities: { image: boolean; video: boolean; audio: boolean } };
      expect(gc.modalities.image).toBe(true);
      expect(gc.modalities.video).toBe(false);
      expect(gc.modalities.audio).toBe(false);
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

    it('fireworks provider without baseUrl uses default Fireworks URL', () => {
      const fireworksProvider: Provider = {
        id: '00000000-0000-0000-0000-000000000099',
        name: 'Fireworks',
        type: 'fireworks',
        apiKey: 'fw-test-key',
        models: [{ name: 'llama-3.1-70b-instruct', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000100',
        name: 'Fireworks Profile',
        models: [{ providerId: fireworksProvider.id, model: 'llama-3.1-70b-instruct', tier: 'base' }],
      };
      const config = adapter.buildConfig(profile, [fireworksProvider]);
      const modelProviders = config.modelProviders as Record<string, Array<Record<string, unknown>>>;
      expect(modelProviders.openai).toBeDefined();
      expect(modelProviders.openai![0]!.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
    });

    it('openrouter provider without baseUrl uses default OpenRouter URL', () => {
      const openrouterProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000a1',
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: 'sk-or-v1-test',
        models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000a2',
        name: 'OR Profile',
        models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' }],
      };
      const config = adapter.buildConfig(profile, [openrouterProvider]);
      const modelProviders = config.modelProviders as Record<string, Array<Record<string, unknown>>>;
      expect(modelProviders.openai).toBeDefined();
      expect(modelProviders.openai![0]!.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

  it('custom-api provider with openai mode appends /v1 to baseUrl', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e1',
      name: 'Custom',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: true, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e2',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const mp = config.modelProviders as Record<string, Array<Record<string, unknown>>>;
    expect(mp['openai']).toHaveLength(1);
    expect(mp['openai']![0]!.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('throws for custom-api provider without openai mode', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e3',
      name: 'Custom',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: true, responses: false },
      models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e4',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'claude-3', tier: 'base' }],
    };
    expect(() => adapter.buildConfig(profile, [customProvider])).toThrow('requires openai mode');
  });

    it('openrouter envKey derives from resolved baseUrl', () => {
      const openrouterProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000a3',
        name: 'OpenRouter',
        type: 'openrouter',
        apiKey: 'sk-or-v1-test',
        models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000a4',
        name: 'OR Profile',
        models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' }],
      };
      const config = adapter.buildConfig(profile, [openrouterProvider]);
      const env = config.env as Record<string, string>;
      expect('QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_OPENROUTER_AI_API_V1' in env).toBe(true);
      expect(env['QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_OPENROUTER_AI_API_V1']).toBe('sk-or-v1-test');
    });
  });

  it('writeConfig sets 0o600 file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-qwen-test-'));
    try {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.qwen', 'settings.json');
      const info = await stat(filePath);
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('writeConfig merge', () => {
    it('preserves unknown top-level keys when mergeEnabled=true', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-qwen-merge-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig({ env: { NEW: '2' }, model: { name: 'new-model' } }, 'project', dir, true);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({
          customKey: 'value',
          env: { OLD: '1', NEW: '2' },
          model: { name: 'new-model' },
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('replaces entire config when mergeEnabled=false', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-qwen-replace-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig({ model: { name: 'new-model' } }, 'project', dir, false);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: { name: 'new-model' } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('writes generated config when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-qwen-new-'));
      try {
        await adapter.writeConfig({ model: { name: 'new-model' } }, 'project', dir, true);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: { name: 'new-model' } });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
