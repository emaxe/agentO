import { describe, it, expect, vi } from 'vitest';
import { CopilotAdapter } from './copilot.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new CopilotAdapter();

const anthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Anthropic',
  type: 'anthropic',
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
    expect(adapter.supportedProviderTypes).toEqual(['openai-compatible', 'anthropic', 'fireworks', 'openrouter']);
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
    it('returns only model field', () => {
      const config = adapter.buildConfig(testProfile, [anthropicProvider]);
      expect(config).toEqual({ model: 'claude-sonnet-4-6' });
    });

    it('selects base tier model when present', () => {
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
      expect(config.model).toBe('sonnet');
    });

    it('throws when provider not found', () => {
      expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
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

    it('throws for openai-compatible without baseUrl', () => {
      const noUrl = { ...openaiCompatibleProvider, baseUrl: undefined };
      const profile: Profile = {
        id: '00000000-0000-0000-0000-000000000018',
        name: 'Local NoUrl',
        models: [{ providerId: noUrl.id, model: 'deepseek' }],
      };
      expect(() => adapter.buildEnv(profile, [noUrl])).toThrow('baseUrl required');
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

  describe('readConfig', () => {
    it('returns null for non-existent project path', async () => {
      const result = await adapter.readConfig('project', '/nonexistent/path-12345');
      expect(result).toBeNull();
    });
  });

  describe('writeConfig', () => {
    it('merges config over existing file', async () => {
      const writtenFiles: Record<string, string> = {};
      vi.doMock('node:fs/promises', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs/promises')>();
        return {
          ...actual,
          mkdir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockImplementation((path: string, content: string) => {
            writtenFiles[path] = content;
            return Promise.resolve();
          }),
          readFile: vi.fn().mockImplementation((path: string) => {
            if (path.includes('settings.json')) {
              return Promise.resolve('{"colorMode":"dim","trustedFolders":["/foo"]}');
            }
            return actual.readFile(path);
          }),
        };
      });
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          existsSync: vi.fn().mockReturnValue(true),
        };
      });
      vi.resetModules();

      const { CopilotAdapter } = await import('./copilot.js');
      const a = new CopilotAdapter();
      await a.writeConfig({ model: 'gpt-5.2' }, 'global');

      const content = writtenFiles[Object.keys(writtenFiles)[0]];
      const parsed = JSON.parse(content);
      expect(parsed.model).toBe('gpt-5.2');
      expect(parsed.colorMode).toBe('dim');
      expect(parsed.trustedFolders).toEqual(['/foo']);
    });
  });
});
