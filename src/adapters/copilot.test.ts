import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from './copilot.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new CopilotAdapter();

const anthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Anthropic',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.anthropic.com',
  models: [{ name: 'claude-sonnet-4-6', capabilities: { image: true, video: false, audio: false } }],
};

const fireworksProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Fireworks',
  type: 'fireworks',
  apiKey: 'fw_test',
  models: [{ name: 'accounts/fireworks/models/llama-v3p1-70b-instruct', capabilities: { image: false, video: false, audio: false } }],
};

const openrouterProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000003',
  name: 'OpenRouter',
  type: 'openrouter',
  apiKey: 'sk-or-test',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
};

const openaiCompatibleProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000004',
  name: 'Local LLM',
  type: 'openai-compatible',
  apiKey: 'local-key',
  baseUrl: 'http://localhost:11434/v1',
  models: [{ name: 'deepseek-coder', capabilities: { image: false, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000010',
  name: 'Test Profile',
  models: [{ providerId: anthropicProvider.id, model: 'claude-sonnet-4-6' }],
};

describe('CopilotAdapter', () => {
  it('has id copilot', () => {
    expect(adapter.id).toBe('copilot');
  });

  it('has displayName Copilot CLI', () => {
    expect(adapter.displayName).toBe('Copilot CLI');
  });

  it('supports all four provider types', () => {
    expect(adapter.supportedProviderTypes).toEqual(['openai-compatible', 'anthropic-compatible', 'fireworks', 'openrouter', 'responses-compatible', 'custom-api']);
  });

  describe('configPaths', () => {
    it('returns global settings.json path', () => {
      const paths = adapter.configPaths();
      expect(paths.global).toMatch(/\.copilot[/\\]settings\.json$/);
    });

    it('returns project settings.json path', () => {
      const paths = adapter.configPaths('/my/project');
      expect(paths.project).toBe('/my/project/.copilot/settings.json');
    });
  });

  describe('buildConfig', () => {
    it('returns empty config (model is passed via env var)', () => {
      const config = adapter.buildConfig(testProfile, [anthropicProvider]);
      expect(config).toEqual({});
    });

    it('ignores base tier model (config is empty)', () => {
      const multi: Profile = {
        id: '00000000-0000-0000-0000-000000000011',
        name: 'Multi',
        models: [
          { providerId: anthropicProvider.id, model: 'haiku', tier: 'small' },
          { providerId: anthropicProvider.id, model: 'sonnet', tier: 'base' },
          { providerId: anthropicProvider.id, model: 'opus', tier: 'smart' },
        ],
      };
      const config = adapter.buildConfig(multi, [anthropicProvider]);
      expect(config).toEqual({});
    });

    it('does not throw when provider not found (no-op)', () => {
      expect(() => adapter.buildConfig(testProfile, [])).not.toThrow();
    });
  });

  describe('buildEnv', () => {
    it('sets COPILOT_MODEL', () => {
      const env = adapter.buildEnv(testProfile, [anthropicProvider]);
      expect(env.COPILOT_MODEL).toBe('claude-sonnet-4-6');
    });

    it('maps anthropic provider type', () => {
      const env = adapter.buildEnv(testProfile, [anthropicProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('anthropic');
    });

    it('maps fireworks to openai type', () => {
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000012',
        name: 'FW',
        models: [{ providerId: fireworksProvider.id, model: 'llama' }],
      };
      const env = adapter.buildEnv(profile, [fireworksProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    });

    it('maps openrouter to openai type', () => {
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000013',
        name: 'OR',
        models: [{ providerId: openrouterProvider.id, model: 'claude-sonnet' }],
      };
      const env = adapter.buildEnv(profile, [openrouterProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    });

    it('maps openai-compatible to openai type', () => {
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000014',
        name: 'Local',
        models: [{ providerId: openaiCompatibleProvider.id, model: 'deepseek' }],
      };
      const env = adapter.buildEnv(profile, [openaiCompatibleProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
    });

    it('sets COPILOT_PROVIDER_BASE_URL from provider', () => {
      const env = adapter.buildEnv(testProfile, [anthropicProvider]);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.anthropic.com');
    });

    it('uses default base URL for fireworks when missing', () => {
      const noUrl = { ...fireworksProvider, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000015',
        name: 'FW NoUrl',
        models: [{ providerId: noUrl.id, model: 'llama' }],
      };
      const env = adapter.buildEnv(profile, [noUrl]);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.fireworks.ai/inference/v1');
    });

    it('uses default base URL for openrouter when missing', () => {
      const noUrl = { ...openrouterProvider, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000016',
        name: 'OR NoUrl',
        models: [{ providerId: noUrl.id, model: 'claude' }],
      };
      const env = adapter.buildEnv(profile, [noUrl]);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    });

    it('uses default base URL for anthropic when missing', () => {
      const noUrl = { ...anthropicProvider, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000017',
        name: 'Anthropic NoUrl',
        models: [{ providerId: noUrl.id, model: 'claude' }],
      };
      const env = adapter.buildEnv(profile, [noUrl]);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.anthropic.com');
    });

    it('uses default OpenAI URL for openai-compatible without baseUrl', () => {
      const noUrl = { ...openaiCompatibleProvider, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000018',
        name: 'Local NoUrl',
        models: [{ providerId: noUrl.id, model: 'deepseek' }],
      };
      const env = adapter.buildEnv(profile, [noUrl]);
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://api.openai.com/v1');
    });

    it('throws for unknown provider type without baseUrl or default URL', () => {
      // Simulates a future provider type added to supportedProviderTypes without
      // a corresponding DEFAULT_BASE_URLS entry — ensures we get a clear error
      // instead of silently setting COPILOT_PROVIDER_BASE_URL to an empty string.
      const unknownProvider = { ...fireworksProvider, type: 'new-type' as ProviderType, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000099',
        name: 'Unknown Type',
        models: [{ providerId: unknownProvider.id, model: 'some-model' }],
      };
      expect(() => adapter.buildEnv(profile, [unknownProvider])).toThrow('No base URL configured');
    });

    it('sets COPILOT_PROVIDER_API_KEY', () => {
      const env = adapter.buildEnv(testProfile, [anthropicProvider]);
      expect(env.COPILOT_PROVIDER_API_KEY).toBe('sk-ant-test123');
    });

    it('sets COPILOT_PROVIDER_WIRE_API to responses for gpt-5 models', () => {
      const gptProvider: Provider = {
        ...openaiCompatibleProvider,
        models: [{ name: 'gpt-5.2', capabilities: { image: false, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000019',
        name: 'GPT5',
        models: [{ providerId: gptProvider.id, model: 'gpt-5.2' }],
      };
      const env = adapter.buildEnv(profile, [gptProvider]);
      expect(env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
    });

    it('does not set wire_api for non-gpt-5 models', () => {
      const env = adapter.buildEnv(testProfile, [anthropicProvider]);
      expect(env.COPILOT_PROVIDER_WIRE_API).toBeUndefined();
    });

    it('returns empty object when provider not found', () => {
      const env = adapter.buildEnv(testProfile, []);
      expect(env).toEqual({});
    });
  });

  describe('custom-api provider', () => {
    it('sets COPILOT_PROVIDER_TYPE to anthropic when anthropic mode enabled', () => {
      const customProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000e1',
        name: 'Custom',
        type: 'custom-api',
        apiKey: 'sk-custom',
        baseUrl: 'https://proxy.example.com',
        customApiModes: { openai: false, anthropic: true, responses: false },
        models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000e2',
        name: 'Custom',
        models: [{ providerId: customProvider.id, model: 'claude-3' }],
      };
      const env = adapter.buildEnv(profile, [customProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('anthropic');
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://proxy.example.com/v1');
    });

    it('sets COPILOT_PROVIDER_TYPE to openai when openai mode enabled', () => {
      const customProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000e3',
        name: 'Custom',
        type: 'custom-api',
        apiKey: 'sk-custom',
        baseUrl: 'https://proxy.example.com',
        customApiModes: { openai: true, anthropic: false, responses: false },
        models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000e4',
        name: 'Custom',
        models: [{ providerId: customProvider.id, model: 'gpt-4' }],
      };
      const env = adapter.buildEnv(profile, [customProvider]);
      expect(env.COPILOT_PROVIDER_TYPE).toBe('openai');
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://proxy.example.com');
    });

    it('sets COPILOT_PROVIDER_WIRE_API to responses for responses mode', () => {
      const customProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000e5',
        name: 'Custom',
        type: 'custom-api',
        apiKey: 'sk-custom',
        baseUrl: 'https://proxy.example.com',
        customApiModes: { openai: false, anthropic: false, responses: true },
        models: [{ name: 'gpt-5', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000e6',
        name: 'Custom',
        models: [{ providerId: customProvider.id, model: 'gpt-5' }],
      };
      const env = adapter.buildEnv(profile, [customProvider]);
      expect(env.COPILOT_PROVIDER_WIRE_API).toBe('responses');
      expect(env.COPILOT_PROVIDER_BASE_URL).toBe('https://proxy.example.com/v1/responses');
    });

    it('throws when no compatible custom-api mode enabled', () => {
      const customProvider: Provider = {
        id: '00000000-0000-0000-0000-0000000000e7',
        name: 'Custom',
        type: 'custom-api',
        apiKey: 'sk-custom',
        baseUrl: 'https://proxy.example.com',
        customApiModes: { openai: false, anthropic: false, responses: false },
        models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
      };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-0000000000e8',
        name: 'Custom',
        models: [{ providerId: customProvider.id, model: 'gpt-4' }],
      };
      expect(() => adapter.buildEnv(profile, [customProvider])).toThrow('requires at least one compatible mode');
    });
  });

  describe('readConfig', () => {
    it('returns null for non-existent project path', async () => {
      const result = await adapter.readConfig('project', '/nonexistent/path-12345');
      expect(result).toBeNull();
    });
  });

  describe('writeConfig', () => {
    it('is a true no-op — resolves without writing files or creating directories', async () => {
      await expect(adapter.writeConfig({}, 'global')).resolves.toBeUndefined();
    });
  });
});
