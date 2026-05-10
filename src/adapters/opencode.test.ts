import { describe, it, expect } from 'vitest';
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

  it('supportedProviderTypes includes all three types', () => {
    expect(adapter.supportedProviderTypes).toEqual(['anthropic', 'openai-compatible', 'fireworks']);
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
});
