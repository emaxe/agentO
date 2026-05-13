import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeAdapter } from './opencode.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new OpenCodeAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Provider',
  type: 'anthropic',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.test.com',
  models: [{ name: 'claude-3-opus', capabilities: { image: true, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'claude-3-opus' }],
};

describe('OpenCodeAdapter', () => {
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
    const openaiProvider = { ...testProvider, type: 'openai-compatible' as const, name: 'Fireworks AI' };
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

  it('supportedProviderTypes includes all four types', () => {
    expect(adapter.supportedProviderTypes).toEqual(['anthropic', 'openai-compatible', 'fireworks', 'openrouter']);
  });

  it('includes modalities based on model capabilities (anthropic)', () => {
    const config = adapter.buildConfig(testProfile, [testProvider]);
    const models = config.models as Record<string, { modalities: { input: string[]; output: string[] } }>;
    expect(models['claude-3-opus'].modalities.input).toContain('text');
    expect(models['claude-3-opus'].modalities.input).toContain('image');
    expect(models['claude-3-opus'].modalities.output).toEqual(['text']);
  });

  it('includes modalities based on model capabilities (openai-compatible)', () => {
    const openaiProvider = { ...testProvider, type: 'openai-compatible' as const, name: 'Fireworks AI' };
    const config = adapter.buildConfig(testProfile, [openaiProvider]);
    const provider = config.provider as Record<string, { models: Record<string, { modalities: { input: string[] } }> }>;
    const fw = provider['fireworks-ai']!;
    expect(fw.models['claude-3-opus'].modalities.input).toContain('image');
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

  it('openrouter respects user baseUrl override', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000c',
      name: 'OpenRouter',
      type: 'openrouter',
      apiKey: 'sk-or-v1-test',
      baseUrl: 'https://proxy.example.com/v1',
      models: [{ name: 'openai/gpt-5', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-00000000000d',
      name: 'OR Custom',
      models: [{ providerId: openrouterProvider.id, model: 'openai/gpt-5', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [openrouterProvider]);
    const provider = config.provider as Record<string, unknown>;
    const or = provider.openrouter as Record<string, unknown>;
    const options = or.options as Record<string, string>;
    expect(options.baseURL).toBe('https://proxy.example.com/v1');
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
    const dir = await mkdtemp(join(tmpdir(), 'agento-oc-test-'));
    try {
      const config = adapter.buildConfig(testProfile, [testProvider]);
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, 'opencode.json');
      const info = await stat(filePath);
      // eslint-disable-next-line no-bitwise
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('writeConfig merge', () => {
    it('preserves unknown top-level keys when mergeEnabled=true', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-oc-merge-'));
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
      const dir = await mkdtemp(join(tmpdir(), 'agento-oc-replace-'));
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
      const dir = await mkdtemp(join(tmpdir(), 'agento-oc-new-'));
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
