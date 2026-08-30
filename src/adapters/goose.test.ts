import { describe, it, expect } from 'vitest';
import { GooseAdapter } from './goose.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new GooseAdapter();

const anthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Anthropic',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.anthropic.com',
  models: [
    { name: 'claude-sonnet-4-6', capabilities: { image: true, video: false, audio: false } },
  ],
};

const fireworksProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Fireworks',
  type: 'fireworks',
  apiKey: 'fw_test',
  models: [
    {
      name: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
      capabilities: { image: false, video: false, audio: false },
    },
  ],
};

const openrouterProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000003',
  name: 'OpenRouter',
  type: 'openrouter',
  apiKey: 'sk-or-test',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [
    {
      name: 'anthropic/claude-sonnet-4.6',
      capabilities: { image: true, video: false, audio: false },
    },
  ],
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

describe('GooseAdapter', () => {
  it('has id goose', () => {
    expect(adapter.id).toBe('goose');
  });

  it('has displayName Goose', () => {
    expect(adapter.displayName).toBe('Goose');
  });

  it('supports all four provider types', () => {
    expect(adapter.supportedProviderTypes).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'fireworks',
      'openrouter',
      'responses-compatible',
      'custom-api',
    ]);
  });

  describe('configPaths', () => {
    it('returns global config.yaml path', () => {
      const paths = adapter.configPaths();
      expect(paths.global).toMatch(/\.config[/\\]goose[/\\]config\.yaml$/);
    });

    it('returns project config.yaml path', () => {
      const paths = adapter.configPaths('/my/project');
      expect(paths.project).toBe('/my/project/.goose/config.yaml');
    });
  });

  describe('buildConfig', () => {
    it('returns empty config (model is passed via env var)', () => {
      const config = adapter.buildConfig(testProfile, [anthropicProvider]);
      expect(config).toEqual({});
    });

    it('does not throw when provider not found (no-op)', () => {
      expect(() => adapter.buildConfig(testProfile, [])).not.toThrow();
    });
  });

  describe('buildEnv', () => {
    describe('anthropic provider', () => {
      it('sets GOOSE_PROVIDER=anthropic', () => {
        const env = adapter.buildEnv(testProfile, [anthropicProvider]);
        expect(env.GOOSE_PROVIDER).toBe('anthropic');
      });

      it('sets GOOSE_MODEL', () => {
        const env = adapter.buildEnv(testProfile, [anthropicProvider]);
        expect(env.GOOSE_MODEL).toBe('claude-sonnet-4-6');
      });

      it('sets ANTHROPIC_API_KEY', () => {
        const env = adapter.buildEnv(testProfile, [anthropicProvider]);
        expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test123');
      });

      it('does not set ANTHROPIC_HOST for default endpoint', () => {
        // Default https://api.anthropic.com should not be passed — Goose already knows it.
        const env = adapter.buildEnv(testProfile, [anthropicProvider]);
        expect(env.ANTHROPIC_HOST).toBeUndefined();
      });

      it('sets ANTHROPIC_HOST for custom endpoint', () => {
        const customProvider = { ...anthropicProvider, baseUrl: 'https://my-proxy.example.com' };
        const env = adapter.buildEnv(testProfile, [customProvider]);
        expect(env.ANTHROPIC_HOST).toBe('https://my-proxy.example.com');
      });

      it('does not set ANTHROPIC_HOST when baseUrl missing', () => {
        const noUrl = { ...anthropicProvider, baseUrl: undefined };
        const profile: Profile = {
          id: '00000000-0000-0000-0000-000000000011',
          name: 'Anthropic NoUrl',
          models: [{ providerId: noUrl.id, model: 'claude-sonnet-4-6' }],
        };
        const env = adapter.buildEnv(profile, [noUrl]);
        expect(env.ANTHROPIC_HOST).toBeUndefined();
      });

      it('does not set OPENAI_API_KEY for anthropic provider', () => {
        const env = adapter.buildEnv(testProfile, [anthropicProvider]);
        expect(env.OPENAI_API_KEY).toBeUndefined();
      });
    });

    describe('openrouter provider', () => {
      const openrouterProfile: Profile = {
        id: '00000000-0000-0000-0000-000000000012',
        name: 'OR',
        models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6' }],
      };

      it('sets GOOSE_PROVIDER=openrouter', () => {
        const env = adapter.buildEnv(openrouterProfile, [openrouterProvider]);
        expect(env.GOOSE_PROVIDER).toBe('openrouter');
      });

      it('sets GOOSE_MODEL', () => {
        const env = adapter.buildEnv(openrouterProfile, [openrouterProvider]);
        expect(env.GOOSE_MODEL).toBe('anthropic/claude-sonnet-4.6');
      });

      it('sets OPENROUTER_API_KEY', () => {
        const env = adapter.buildEnv(openrouterProfile, [openrouterProvider]);
        expect(env.OPENROUTER_API_KEY).toBe('sk-or-test');
      });

      it('does not set OPENROUTER_HOST for default openrouter.ai endpoint', () => {
        // baseUrl https://openrouter.ai/api/v1 starts with https://openrouter.ai — no override needed.
        const env = adapter.buildEnv(openrouterProfile, [openrouterProvider]);
        expect(env.OPENROUTER_HOST).toBeUndefined();
      });

      it('sets OPENROUTER_HOST for non-default endpoint', () => {
        const customProvider = {
          ...openrouterProvider,
          baseUrl: 'https://my-openrouter-proxy.example.com',
        };
        const env = adapter.buildEnv(openrouterProfile, [customProvider]);
        expect(env.OPENROUTER_HOST).toBe('https://my-openrouter-proxy.example.com');
      });

      it('does not set OPENAI_API_KEY for openrouter', () => {
        const env = adapter.buildEnv(openrouterProfile, [openrouterProvider]);
        expect(env.OPENAI_API_KEY).toBeUndefined();
      });
    });

    describe('fireworks provider (routed via openai)', () => {
      const fireworksProfile: Profile = {
        id: '00000000-0000-0000-0000-000000000013',
        name: 'FW',
        models: [
          {
            providerId: fireworksProvider.id,
            model: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
          },
        ],
      };

      it('sets GOOSE_PROVIDER=openai', () => {
        const env = adapter.buildEnv(fireworksProfile, [fireworksProvider]);
        expect(env.GOOSE_PROVIDER).toBe('openai');
      });

      it('sets GOOSE_MODEL', () => {
        const env = adapter.buildEnv(fireworksProfile, [fireworksProvider]);
        expect(env.GOOSE_MODEL).toBe('accounts/fireworks/models/llama-v3p1-70b-instruct');
      });

      it('sets OPENAI_API_KEY from fireworks apiKey', () => {
        const env = adapter.buildEnv(fireworksProfile, [fireworksProvider]);
        expect(env.OPENAI_API_KEY).toBe('fw_test');
      });

      it('strips /v1 from fireworks default URL for OPENAI_HOST', () => {
        // Goose appends /v1/chat/completions to OPENAI_HOST itself — passing /v1 would
        // produce the double-versioned path /v1/v1/chat/completions.
        const env = adapter.buildEnv(fireworksProfile, [fireworksProvider]);
        expect(env.OPENAI_HOST).toBe('https://api.fireworks.ai/inference');
      });

      it('strips /v1 from custom baseUrl', () => {
        const withUrl = { ...fireworksProvider, baseUrl: 'https://custom.fireworks.ai/v1' };
        const env = adapter.buildEnv(fireworksProfile, [withUrl]);
        expect(env.OPENAI_HOST).toBe('https://custom.fireworks.ai');
      });

      it('leaves baseUrl without /v1 unchanged', () => {
        const withUrl = { ...fireworksProvider, baseUrl: 'https://custom.fireworks.ai/api' };
        const env = adapter.buildEnv(fireworksProfile, [withUrl]);
        expect(env.OPENAI_HOST).toBe('https://custom.fireworks.ai/api');
      });
    });

    describe('openai-compatible provider', () => {
      const localProfile: Profile = {
        id: '00000000-0000-0000-0000-000000000014',
        name: 'Local',
        models: [{ providerId: openaiCompatibleProvider.id, model: 'deepseek-coder' }],
      };

      it('sets GOOSE_PROVIDER=openai', () => {
        const env = adapter.buildEnv(localProfile, [openaiCompatibleProvider]);
        expect(env.GOOSE_PROVIDER).toBe('openai');
      });

      it('sets GOOSE_MODEL', () => {
        const env = adapter.buildEnv(localProfile, [openaiCompatibleProvider]);
        expect(env.GOOSE_MODEL).toBe('deepseek-coder');
      });

      it('sets OPENAI_API_KEY', () => {
        const env = adapter.buildEnv(localProfile, [openaiCompatibleProvider]);
        expect(env.OPENAI_API_KEY).toBe('local-key');
      });

      it('strips /v1 from baseUrl for OPENAI_HOST', () => {
        // http://localhost:11434/v1 → http://localhost:11434
        const env = adapter.buildEnv(localProfile, [openaiCompatibleProvider]);
        expect(env.OPENAI_HOST).toBe('http://localhost:11434');
      });

      it('uses default OpenAI host when baseUrl missing', () => {
        const noUrl = { ...openaiCompatibleProvider, baseUrl: undefined };
        const profile: Profile = {
          id: '00000000-0000-0000-0000-000000000015',
          name: 'Local NoUrl',
          models: [{ providerId: noUrl.id, model: 'deepseek' }],
        };
        const env = adapter.buildEnv(profile, [noUrl]);
        expect(env.OPENAI_HOST).toBe('https://api.openai.com');
      });
    });

    it('throws when the profile references a provider that no longer exists', () => {
      // Returning {} here used to launch the agent with no provider config at
      // all, silently falling back to whatever was already in the environment.
      expect(() => adapter.buildEnv(testProfile, [])).toThrow('Provider not found');
    });

    it('uses base tier model when present', () => {
      const multi: Profile = {
        id: '00000000-0000-0000-0000-000000000021',
        name: 'Multi',
        models: [
          { providerId: anthropicProvider.id, model: 'haiku', tier: 'small' },
          { providerId: anthropicProvider.id, model: 'sonnet', tier: 'base' },
          { providerId: anthropicProvider.id, model: 'opus', tier: 'smart' },
        ],
      };
      const env = adapter.buildEnv(multi, [anthropicProvider]);
      expect(env.GOOSE_MODEL).toBe('sonnet');
    });
  });

  describe('custom-api provider', () => {
    it('routes to anthropic when anthropic mode enabled', () => {
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
      expect(env.GOOSE_PROVIDER).toBe('anthropic');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-custom');
      expect(env.ANTHROPIC_HOST).toBe('https://proxy.example.com');
    });

    it('routes to openai when openai mode enabled', () => {
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
      expect(env.GOOSE_PROVIDER).toBe('openai');
      expect(env.OPENAI_API_KEY).toBe('sk-custom');
      expect(env.OPENAI_HOST).toBe('https://proxy.example.com');
    });

    it('throws when no compatible custom-api mode enabled', () => {
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
        models: [{ providerId: customProvider.id, model: 'gpt-4' }],
      };
      expect(() => adapter.buildEnv(profile, [customProvider])).toThrow(
        'requires at least one compatible mode',
      );
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
