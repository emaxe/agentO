import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PiAdapter } from './pi.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new PiAdapter();

const anthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Anthropic',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.anthropic.com',
  models: [{ name: 'claude-sonnet-4-6', capabilities: { image: true, video: false, audio: false } }],
};

const openaiProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'OpenAI',
  type: 'openai-compatible',
  apiKey: 'sk-openai-test',
  baseUrl: 'https://api.openai.com/v1',
  models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
};

const fireworksProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000003',
  name: 'Fireworks',
  type: 'fireworks',
  apiKey: 'fw_test',
  models: [{ name: 'accounts/fireworks/models/llama-v3p1-70b-instruct', capabilities: { image: false, video: false, audio: false } }],
};

const openrouterProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000004',
  name: 'OpenRouter',
  type: 'openrouter',
  apiKey: 'sk-or-test',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
};

const customApiOpenAiProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000005',
  name: 'Custom OpenAI',
  type: 'custom-api',
  apiKey: 'sk-custom-test',
  baseUrl: 'https://custom.api/v1',
  models: [{ name: 'custom-model', capabilities: { image: false, video: false, audio: false } }],
  customApiModes: { openai: true, anthropic: false, responses: false },
};

const customApiAnthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000006',
  name: 'Custom Anthropic',
  type: 'custom-api',
  apiKey: 'sk-custom-ant-test',
  baseUrl: 'https://custom-ant.api',
  models: [{ name: 'custom-model', capabilities: { image: false, video: false, audio: false } }],
  customApiModes: { openai: false, anthropic: true, responses: false },
};

const customApiNoModeProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000007',
  name: 'Custom No Mode',
  type: 'custom-api',
  apiKey: 'sk-custom-none',
  models: [{ name: 'custom-model', capabilities: { image: false, video: false, audio: false } }],
  customApiModes: { openai: false, anthropic: false, responses: false },
};

const testProfileAnthropic: Profile = {
  id: '00000000-0000-0000-0000-000000000010',
  name: 'Test Anthropic',
  models: [{ providerId: anthropicProvider.id, model: 'claude-sonnet-4-6' }],
};

const testProfileOpenAi: Profile = {
  id: '00000000-0000-0000-0000-000000000011',
  name: 'Test OpenAI',
  models: [{ providerId: openaiProvider.id, model: 'gpt-4o' }],
};

const testProfileFireworks: Profile = {
  id: '00000000-0000-0000-0000-000000000012',
  name: 'Test Fireworks',
  models: [{ providerId: fireworksProvider.id, model: 'accounts/fireworks/models/llama-v3p1-70b-instruct' }],
};

const testProfileOpenRouter: Profile = {
  id: '00000000-0000-0000-0000-000000000013',
  name: 'Test OpenRouter',
  models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6' }],
};

const testProfileCustomOpenAi: Profile = {
  id: '00000000-0000-0000-0000-000000000014',
  name: 'Test Custom OpenAI',
  models: [{ providerId: customApiOpenAiProvider.id, model: 'custom-model' }],
};

const testProfileCustomAnthropic: Profile = {
  id: '00000000-0000-0000-0000-000000000015',
  name: 'Test Custom Anthropic',
  models: [{ providerId: customApiAnthropicProvider.id, model: 'custom-model' }],
};

const testProfileCustomNoMode: Profile = {
  id: '00000000-0000-0000-0000-000000000016',
  name: 'Test Custom No Mode',
  models: [{ providerId: customApiNoModeProvider.id, model: 'custom-model' }],
};

describe('PiAdapter', () => {
  it('has id pi', () => {
    expect(adapter.id).toBe('pi');
  });

  it('has displayName PI', () => {
    expect(adapter.displayName).toBe('PI');
  });

  it('supports five provider types', () => {
    expect(adapter.supportedProviderTypes).toEqual([
      'anthropic-compatible',
      'openai-compatible',
      'fireworks',
      'openrouter',
      'custom-api',
    ]);
  });

  it('configPaths returns settings.json (not models.json)', () => {
    const paths = adapter.configPaths('/test/cwd');
    expect(paths.global).toBe(join(homedir(), '.pi', 'agent', 'settings.json'));
    expect(paths.project).toBe(join(homedir(), '.pi', 'agent', 'settings.json'));
  });

  describe('buildConfig', () => {
    it('returns modelsJson with custom model even without baseUrl', () => {
      const providerWithoutBase: Provider = {
        ...customApiOpenAiProvider,
        baseUrl: undefined,
      };
      const cfg = adapter.buildConfig(testProfileCustomOpenAi, [providerWithoutBase]);
      expect(cfg.defaultProvider).toBe('openai');
      expect(cfg.defaultModel).toBe('custom-model');
      expect(cfg.__agento_models_json__).toBeDefined();
      const mj = cfg.__agento_models_json__ as Record<string, unknown>;
      const openaiProvider = ((mj.providers as Record<string, unknown>)?.openai as Record<string, unknown>);
      expect(openaiProvider?.models).toBeDefined();
      expect(openaiProvider?.baseUrl).toBeUndefined();
    });

    it('returns defaultProvider and defaultModel for openai-compatible', () => {
      const cfg = adapter.buildConfig(testProfileOpenAi, [openaiProvider]);
      expect(cfg.defaultProvider).toBe('openai');
      expect(cfg.defaultModel).toBe('gpt-4o');
    });

    it('returns defaultProvider and defaultModel for anthropic-compatible', () => {
      const cfg = adapter.buildConfig(testProfileAnthropic, [anthropicProvider]);
      expect(cfg.defaultProvider).toBe('anthropic');
      expect(cfg.defaultModel).toBe('claude-sonnet-4-6');
    });

    it('returns defaultProvider and defaultModel for custom-api with anthropic mode', () => {
      const cfg = adapter.buildConfig(testProfileCustomAnthropic, [customApiAnthropicProvider]);
      expect(cfg.defaultProvider).toBe('anthropic');
      expect(cfg.defaultModel).toBe('custom-model');
    });

    it('returns defaultProvider and defaultModel for custom-api with openai mode', () => {
      const cfg = adapter.buildConfig(testProfileCustomOpenAi, [customApiOpenAiProvider]);
      expect(cfg.defaultProvider).toBe('openai');
      expect(cfg.defaultModel).toBe('custom-model');
    });

    it('returns empty object when provider not found', () => {
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000017',
        name: 'Missing Provider',
        models: [{ providerId: '00000000-0000-0000-0000-000000000999', model: 'unknown' }],
      };
      const cfg = adapter.buildConfig(profile, [anthropicProvider]);
      expect(cfg.defaultProvider).toBeUndefined();
      expect(cfg.defaultModel).toBeUndefined();
    });

    it('includes models.json payload for provider with baseUrl', () => {
      const cfg = adapter.buildConfig(testProfileOpenAi, [openaiProvider]);
      expect(cfg.__agento_models_json__).toEqual({
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            models: [
              {
                id: 'gpt-4o',
                name: 'gpt-4o',
                api: 'openai-completions',
              },
            ],
          },
        },
      });
    });

    it('uses anthropic-messages api for anthropic-compatible', () => {
      const cfg = adapter.buildConfig(testProfileAnthropic, [anthropicProvider]);
      const mj = cfg.__agento_models_json__ as Record<string, unknown>;
      const models = ((mj?.providers as Record<string, unknown>)?.anthropic as Record<string, unknown>)?.models as Array<Record<string, string>>;
      expect(models?.[0]?.api).toBe('anthropic-messages');
    });
  });

  describe('buildEnv', () => {
    it('returns ANTHROPIC_API_KEY for anthropic-compatible provider', () => {
      const env = adapter.buildEnv(testProfileAnthropic, [anthropicProvider]);
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test123');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('returns OPENAI_API_KEY for openai-compatible provider', () => {
      const env = adapter.buildEnv(testProfileOpenAi, [openaiProvider]);
      expect(env.OPENAI_API_KEY).toBe('sk-openai-test');
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    it('returns FIREWORKS_API_KEY for fireworks provider', () => {
      const env = adapter.buildEnv(testProfileFireworks, [fireworksProvider]);
      expect(env.FIREWORKS_API_KEY).toBe('fw_test');
    });

    it('returns OPENROUTER_API_KEY for openrouter provider', () => {
      const env = adapter.buildEnv(testProfileOpenRouter, [openrouterProvider]);
      expect(env.OPENROUTER_API_KEY).toBe('sk-or-test');
    });

    it('returns OPENAI_API_KEY for custom-api with openai mode (no baseUrl in env)', () => {
      const env = adapter.buildEnv(testProfileCustomOpenAi, [customApiOpenAiProvider]);
      expect(env.OPENAI_API_KEY).toBe('sk-custom-test');
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    it('returns ANTHROPIC_API_KEY for custom-api with anthropic mode (no baseUrl in env)', () => {
      const env = adapter.buildEnv(testProfileCustomAnthropic, [customApiAnthropicProvider]);
      expect(env.ANTHROPIC_API_KEY).toBe('sk-custom-ant-test');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('throws for custom-api without openai or anthropic modes', () => {
      expect(() => adapter.buildEnv(testProfileCustomNoMode, [customApiNoModeProvider])).toThrow(
        'PI requires a custom-api provider with either openai or anthropic wire protocol',
      );
    });

    it('throws when provider is not found', () => {
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000017',
        name: 'Missing Provider',
        models: [{ providerId: '00000000-0000-0000-0000-000000000999', model: 'unknown' }],
      };
      expect(() => adapter.buildEnv(profile, [anthropicProvider])).toThrow('Provider not found');
    });
  });
});
