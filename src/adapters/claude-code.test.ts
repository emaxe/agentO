import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter, CLAUDE_API_KEY_ENV } from './claude-code.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new ClaudeCodeAdapter();

const API_KEY_HELPER = `sh -c 'printf %s "$${CLAUDE_API_KEY_ENV}"'`;

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Provider',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.test.com',
  models: [{ name: 'claude-3-opus', capabilities: { image: true, video: false, audio: false } }],
};

const singleModelProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'claude-3-opus' }],
};

describe('ClaudeCodeAdapter', () => {
  it('single-model profile applies one model to all tiers', () => {
    const config = adapter.buildConfig(singleModelProfile, [testProvider]);
    const env = config.env as Record<string, string>;
    expect(config.apiKeyHelper).toBe(API_KEY_HELPER);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.test.com');
    expect(env.ANTHROPIC_MODEL).toBe('claude-3-opus');
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('claude-3-opus');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-3-opus');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-3-opus');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-3-opus');
    expect(config.model).toBe('claude-3-opus');
  });

  it('multi-tier profile maps small/base/smart correctly', () => {
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Multi',
      models: [
        { providerId: testProvider.id, model: 'claude-3-haiku', tier: 'small' },
        { providerId: testProvider.id, model: 'claude-3-sonnet', tier: 'base' },
        { providerId: testProvider.id, model: 'claude-3-opus', tier: 'smart' },
      ],
    };
    const config = adapter.buildConfig(profile, [testProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_MODEL).toBe('claude-3-sonnet');
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('claude-3-haiku');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-3-haiku');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-3-sonnet');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-3-opus');
    expect(config.model).toBe('claude-3-sonnet');
  });

  it('missing tier falls back to base', () => {
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Partial',
      models: [
        { providerId: testProvider.id, model: 'claude-3-sonnet', tier: 'base' },
        { providerId: testProvider.id, model: 'claude-3-haiku', tier: 'small' },
      ],
    };
    const config = adapter.buildConfig(profile, [testProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-3-sonnet');
  });

  it('buildConfig without baseUrl omits ANTHROPIC_BASE_URL', () => {
    const providerNoUrl = { ...testProvider, baseUrl: undefined };
    const config = adapter.buildConfig(singleModelProfile, [providerNoUrl]);
    const env = config.env as Record<string, string>;
    expect(config.apiKeyHelper).toBe(API_KEY_HELPER);
    expect('ANTHROPIC_BASE_URL' in env).toBe(false);
  });

  it('never writes the API key into the config, whatever it contains', () => {
    const tricky = { ...testProvider, apiKey: "abc'def" };
    const config = adapter.buildConfig(singleModelProfile, [tricky]);
    // The helper reads the key from the environment, so no shell escaping is
    // needed and the secret cannot leak into a committed settings.json.
    expect(config.apiKeyHelper).toBe(API_KEY_HELPER);
    expect(JSON.stringify(config)).not.toContain("abc'def");
  });

  it('buildConfig throws if provider not found', () => {
    expect(() => adapter.buildConfig(singleModelProfile, [])).toThrow('Provider not found');
  });

  it('configPaths returns correct paths', () => {
    const paths = adapter.configPaths('/my/project');
    expect(paths.project).toContain('.claude/settings.json');
    expect(paths.global).toContain('.claude/settings.json');
  });

  it('throws when tiers use different providers', () => {
    const secondProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000099',
      name: 'Second Provider',
      type: 'anthropic-compatible',
      apiKey: 'sk-ant-other',
      models: [
        { name: 'claude-3-haiku', capabilities: { image: true, video: false, audio: false } },
      ],
    };
    const mixedProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'Mixed',
      models: [
        { providerId: testProvider.id, model: 'claude-3-sonnet', tier: 'base' },
        { providerId: secondProvider.id, model: 'claude-3-haiku', tier: 'small' },
      ],
    };
    expect(() => adapter.buildConfig(mixedProfile, [testProvider, secondProvider])).toThrow(
      'Claude Code supports only one provider per profile',
    );
  });

  it('supportedProviderTypes includes anthropic, fireworks, openrouter, custom-api, openai-compatible, and responses-compatible', () => {
    expect(adapter.supportedProviderTypes).toContain('anthropic-compatible');
    expect(adapter.supportedProviderTypes).toContain('fireworks');
    expect(adapter.supportedProviderTypes).toContain('openrouter');
    expect(adapter.supportedProviderTypes).toContain('custom-api');
    expect(adapter.supportedProviderTypes).toContain('openai-compatible');
    expect(adapter.supportedProviderTypes).toContain('responses-compatible');
  });

  it('openrouter uses ANTHROPIC_AUTH_TOKEN and empty ANTHROPIC_API_KEY, no apiKeyHelper', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000a',
      name: 'OpenRouter',
      type: 'openrouter',
      apiKey: 'sk-or-v1-test',
      models: [
        {
          name: 'anthropic/claude-sonnet-4.6',
          capabilities: { image: true, video: false, audio: false },
        },
      ],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-00000000000b',
      name: 'OR Profile',
      models: [
        { providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' },
      ],
    };
    const config = adapter.buildConfig(profile, [openrouterProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(config.apiKeyHelper).toBeUndefined();
    // The Bearer token is delivered through the process env, never the config.
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(adapter.buildEnv(profile, [openrouterProvider])).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'sk-or-v1-test',
    });
    expect(config.model).toBe('anthropic/claude-sonnet-4.6');
  });

  it('openrouter respects user baseUrl override', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000c',
      name: 'OpenRouter Custom',
      type: 'openrouter',
      apiKey: 'sk-or-v1-test',
      baseUrl: 'https://proxy.example.com',
      models: [
        {
          name: 'anthropic/claude-sonnet-4.6',
          capabilities: { image: true, video: false, audio: false },
        },
      ],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-00000000000d',
      name: 'OR Custom',
      models: [
        { providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' },
      ],
    };
    const config = adapter.buildConfig(profile, [openrouterProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
  });

  it('fireworks provider without baseUrl uses default Fireworks URL', () => {
    const fireworksProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000006',
      name: 'Fireworks',
      type: 'fireworks',
      apiKey: 'fw-test-key',
      models: [
        {
          name: 'llama-3.1-70b-instruct',
          capabilities: { image: true, video: false, audio: false },
        },
      ],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000007',
      name: 'Fireworks Profile',
      models: [{ providerId: fireworksProvider.id, model: 'llama-3.1-70b-instruct', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [fireworksProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.fireworks.ai/inference');
  });

  it('custom-api provider uses resolveCustomApiUrl for ANTHROPIC_BASE_URL', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e1',
      name: 'Custom Anthropic',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: true, responses: false },
      models: [
        { name: 'claude-3-sonnet', capabilities: { image: true, video: false, audio: false } },
      ],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e2',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'claude-3-sonnet', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
  });

  it('throws for custom-api provider without anthropic, openai, or responses mode', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e3',
      name: 'Custom Bad',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e4',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    expect(() => adapter.buildConfig(profile, [customProvider])).toThrow(
      'requires anthropic, openai, or responses mode',
    );
  });

  it('custom-api provider with openai mode uses resolveCustomApiUrl for ANTHROPIC_BASE_URL', () => {
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
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com/v1');
    expect(env.ANTHROPIC_MODEL).toBe('gpt-4');
    expect(config.apiKeyHelper).toBe(API_KEY_HELPER);
  });

  it('custom-api provider prefers anthropic when both modes are enabled', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-0000000000e3',
      name: 'Custom Both',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: true, anthropic: true, responses: false },
      models: [
        { name: 'claude-3-sonnet', capabilities: { image: true, video: false, audio: false } },
      ],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-0000000000e4',
      name: 'Custom',
      models: [{ providerId: customProvider.id, model: 'claude-3-sonnet', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
    expect(config.model).toBe('claude-3-sonnet');
  });

  it('writeConfig sets 0o600 file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-cc-test-'));
    try {
      const config = adapter.buildConfig(singleModelProfile, [testProvider]);
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.claude', 'settings.json');
      const info = await stat(filePath);
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('openai-compatible provider without baseUrl uses default OpenAI URL', () => {
    const openaiProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'OpenAI',
      type: 'openai-compatible',
      apiKey: 'sk-openai-test',
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'OpenAI Profile',
      models: [{ providerId: openaiProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [openaiProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.openai.com/v1');
    expect(config.apiKeyHelper).toBe(API_KEY_HELPER);
  });

  it('openai-compatible provider respects user baseUrl override', () => {
    const openaiProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000012',
      name: 'OpenAI Custom',
      type: 'openai-compatible',
      apiKey: 'sk-openai-test',
      baseUrl: 'https://proxy.example.com',
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000013',
      name: 'OpenAI Custom Profile',
      models: [{ providerId: openaiProvider.id, model: 'gpt-4', tier: 'base' }],
    };
    const config = adapter.buildConfig(profile, [openaiProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
  });

  it('supportedProviderTypes includes responses-compatible', () => {
    expect(adapter.supportedProviderTypes).toContain('responses-compatible');
  });

  it('responses-compatible provider sets ANTHROPIC_BASE_URL to baseUrl', () => {
    const responsesProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'OpenAI Responses',
      type: 'responses-compatible',
      apiKey: 'sk-resp',
      baseUrl: 'https://api.openai.com',
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Responses Profile',
      models: [{ providerId: responsesProvider.id, model: 'gpt-4o' }],
    };
    const config = adapter.buildConfig(profile, [responsesProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.openai.com');
  });

  it('custom-api provider with responses mode sets ANTHROPIC_BASE_URL to baseUrl', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Custom Responses',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: true },
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000013',
      name: 'Custom Responses Profile',
      models: [{ providerId: customProvider.id, model: 'gpt-4o' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
  });

  describe('writeConfig merge', () => {
    it('preserves unknown top-level keys when mergeEnabled=true', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-cc-merge-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig(
          { env: { NEW: '2' }, model: 'claude-3-sonnet' },
          'project',
          dir,
          true,
        );
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({
          customKey: 'value',
          env: { OLD: '1', NEW: '2' },
          model: 'claude-3-sonnet',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('replaces entire config when mergeEnabled=false', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-cc-replace-'));
      try {
        await adapter.writeConfig({ customKey: 'value', env: { OLD: '1' } }, 'project', dir);
        await adapter.writeConfig({ model: 'claude-3-sonnet' }, 'project', dir, false);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: 'claude-3-sonnet' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('writes generated config when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agento-cc-new-'));
      try {
        await adapter.writeConfig({ model: 'claude-3-sonnet' }, 'project', dir, true);
        const result = await adapter.readConfig('project', dir);
        expect(result).toEqual({ model: 'claude-3-sonnet' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
