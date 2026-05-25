import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KiloAdapter } from './kilo.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new KiloAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Provider',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.test.com',
  models: [{ name: 'claude-3-opus', capabilities: { image: true, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'claude-3-opus' }],
};

describe('KiloAdapter', () => {
  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('kilo');
    expect(adapter.displayName).toBe('Kilo Code');
  });

  it('buildConfig returns correct model and provider', () => {
    const config = adapter.buildConfig(testProfile, [testProvider]);
    expect(config.model).toBe('anthropic/claude-3-opus');
    const provider = config.provider as Record<string, unknown>;
    expect('anthropic' in provider).toBe(true);
    const anthropic = provider.anthropic as Record<string, unknown>;
    const options = anthropic.options as Record<string, string>;
    expect(options.apiKey).toBe('sk-ant-test123');
    expect(options.baseURL).toBe('https://api.test.com');
  });

  it('buildConfig without baseUrl omits baseURL from options', () => {
    const providerNoUrl = { ...testProvider, baseUrl: undefined };
    const config = adapter.buildConfig(testProfile, [providerNoUrl]);
    const provider = config.provider as Record<string, unknown>;
    const anthropic = provider.anthropic as Record<string, unknown>;
    const options = anthropic.options as Record<string, unknown>;
    expect('baseURL' in options).toBe(false);
    expect(options.apiKey).toBe('sk-ant-test123');
  });

  it('buildConfig throws if provider not found', () => {
    expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
  });

  it('openai-compatible uses normalized provider name as key', () => {
    const openaiProvider = { ...testProvider, type: 'openai-compatible' as const, name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/v1' };
    const config = adapter.buildConfig(testProfile, [openaiProvider]);
    expect(config.model).toBe('fireworks-ai/claude-3-opus');
    const provider = config.provider as Record<string, unknown>;
    expect('fireworks-ai' in provider).toBe(true);
    const fw = provider['fireworks-ai'] as Record<string, unknown>;
    expect(fw.npm).toBe('@ai-sdk/openai-compatible');
    expect(fw.name).toBe('Fireworks AI');
    const models = fw.models as Record<string, unknown>;
    expect('claude-3-opus' in models).toBe(true);
    const options = fw.options as Record<string, unknown>;
    expect(options.apiKey).toBe('sk-ant-test123');
  });

  it('openai-compatible with no baseUrl uses native @ai-sdk/openai for actual OpenAI API', () => {
    const openaiProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'OpenAI',
      type: 'openai-compatible',
      apiKey: 'sk-openai-test',
      models: [{ name: 'gpt-5.4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'OpenAI Profile',
      models: [{ providerId: openaiProvider.id, model: 'gpt-5.4', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [openaiProvider]);
    expect(config.model).toBe('openai/gpt-5.4');
    const provider = config.provider as Record<string, unknown>;
    expect('openai' in provider).toBe(true);
    const entry = provider.openai as Record<string, unknown>;
    expect(entry.npm).toBe('@ai-sdk/openai');
    const options = entry.options as Record<string, unknown>;
    expect(options.apiKey).toBe('sk-openai-test');
    expect('baseURL' in options).toBe(false);
  });

  it('multi-tier profile selects base tier model', () => {
    const multiTierProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Multi Tier',
      models: [
        { providerId: testProvider.id, model: 'claude-3-haiku', tier: 'small' },
        { providerId: testProvider.id, model: 'claude-3-sonnet', tier: 'base' },
        { providerId: testProvider.id, model: 'claude-3-opus', tier: 'smart' },
      ],
    };
    const config = adapter.buildConfig(multiTierProfile, [testProvider]);
    expect(config.model).toBe('anthropic/claude-3-sonnet');
  });

  it('supportedProviderTypes includes all six types', () => {
    expect(adapter.supportedProviderTypes).toEqual(['anthropic-compatible', 'openai-compatible', 'fireworks', 'openrouter', 'responses-compatible', 'custom-api']);
  });

  it('includes modalities based on model capabilities (anthropic)', () => {
    const config = adapter.buildConfig(testProfile, [testProvider]);
    const models = config.models as Record<string, { modalities: { input: string[]; output: string[] } }>;
    expect(models['claude-3-opus'].modalities.input).toContain('text');
    expect(models['claude-3-opus'].modalities.input).toContain('image');
    expect(models['claude-3-opus'].modalities.output).toEqual(['text']);
  });

  it('excludes image from modalities when capability is false', () => {
    const noImageProvider: Provider = {
      ...testProvider,
      models: [{ name: 'claude-3-opus', capabilities: { image: false, video: false, audio: true } }],
    };
    const config = adapter.buildConfig(testProfile, [noImageProvider]);
    const models = config.models as Record<string, { modalities: { input: string[] } }>;
    expect(models['claude-3-opus'].modalities.input).not.toContain('image');
    expect(models['claude-3-opus'].modalities.input).toContain('audio');
  });

  it('openrouter provider uses fixed key "openrouter" and default URL', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000a',
      name: 'My Custom OpenRouter',
      type: 'openrouter',
      apiKey: 'sk-or-v1-test',
      models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-00000000000b',
      name: 'OR Profile',
      models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [openrouterProvider]);
    expect(config.model).toBe('openrouter/anthropic/claude-sonnet-4.6');
    const provider = config.provider as Record<string, unknown>;
    expect('openrouter' in provider).toBe(true);
    const or = provider.openrouter as Record<string, unknown>;
    expect(or.npm).toBe('@ai-sdk/openai-compatible');
    expect(or.name).toBe('My Custom OpenRouter');
    const options = or.options as Record<string, string>;
    expect(options.apiKey).toBe('sk-or-v1-test');
    expect(options.baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('fireworks provider without baseUrl uses default Fireworks URL', () => {
    const fireworksProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Fireworks',
      type: 'fireworks',
      apiKey: 'fw-test-key',
      models: [{ name: 'llama-3.1-70b-instruct', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'Fireworks Profile',
      models: [{ providerId: fireworksProvider.id, model: 'llama-3.1-70b-instruct', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [fireworksProvider]);
    expect(config.model).toBe('fireworks/llama-3.1-70b-instruct');
    const provider = config.provider as Record<string, unknown>;
    expect('fireworks' in provider).toBe(true);
    const fw = provider.fireworks as Record<string, unknown>;
    expect(fw.npm).toBe('@ai-sdk/openai-compatible');
    const options = fw.options as Record<string, string>;
    expect(options.baseURL).toBe('https://api.fireworks.ai/inference/v1');
  });

  it('writeConfig sets 0o600 file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-kilo-test-'));
    try {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, 'kilocode.json');
      const info = await stat(filePath);
      // eslint-disable-next-line no-bitwise
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('custom-api provider with anthropic mode returns anthropic provider block', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e1',
      name: 'Custom Anthropic',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: true, responses: false },
      models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e2',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'claude-3', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    expect(config.model).toBe('anthropic/claude-3');
    const provider = config.provider as Record<string, unknown>;
    expect('anthropic' in provider).toBe(true);
    const anthropic = provider.anthropic as Record<string, unknown>;
    const options = anthropic.options as Record<string, string>;
    expect(options.baseURL).toBe('https://proxy.example.com/v1');
  });

  it('custom-api provider with openai mode returns @ai-sdk/openai-compatible block', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e3',
      name: 'Custom OpenAI',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: true, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e4',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const provider = config.provider as Record<string, unknown>;
    expect('custom-openai' in provider).toBe(true);
    const entry = provider['custom-openai'] as Record<string, unknown>;
    expect(entry.npm).toBe('@ai-sdk/openai-compatible');
    const options = entry.options as Record<string, string>;
    expect(options.baseURL).toBe('https://proxy.example.com');
  });

  it('throws for custom-api provider without compatible mode', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e5',
      name: 'Custom',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e6',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    expect(() => adapter.buildConfig(profile, [customProvider])).toThrow('requires at least one compatible mode');
  });

  describe('writeConfig merge', () => {
    it('preserves unknown top-level keys when mergeEnabled=true', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-kilo-merge-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig({ env: { NEW: '2' }, model: 'new-model' }, 'project', dir, true);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({
          customKey: 'value',
          env: { NEW: '2' },
          model: 'new-model',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('replaces entire config when mergeEnabled=false', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-kilo-replace-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig({ model: 'new-model' }, 'project', dir, false);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: 'new-model' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('writes generated config when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-kilo-new-'));
      try {
        await adapter.writeConfig({ model: 'new-model' }, 'project', dir, true);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: 'new-model' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
