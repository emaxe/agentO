import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter } from './claude-code.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new ClaudeCodeAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Provider',
  type: 'anthropic',
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
    expect(config.apiKeyHelper).toBe("bash -c 'echo sk-ant-test123'");
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
    expect(config.apiKeyHelper).toBe("bash -c 'echo sk-ant-test123'");
    expect('ANTHROPIC_BASE_URL' in env).toBe(false);
  });

  it('apiKeyHelper escapes single quotes in apiKey', () => {
    const tricky = { ...testProvider, apiKey: "abc'def" };
    const config = adapter.buildConfig(singleModelProfile, [tricky]);
    expect(config.apiKeyHelper).toBe("bash -c 'echo abc'\\''def'");
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
      type: 'anthropic',
      apiKey: 'sk-ant-other',
      models: [{ name: 'claude-3-haiku', capabilities: { image: true, video: false, audio: false } }],
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
      'Claude Code supports only one provider per profile'
    );
  });

  it('supportedProviderTypes includes anthropic, fireworks, and openrouter', () => {
    expect(adapter.supportedProviderTypes).toEqual(['anthropic', 'fireworks', 'openrouter']);
  });

  it('openrouter uses ANTHROPIC_AUTH_TOKEN and empty ANTHROPIC_API_KEY, no apiKeyHelper', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000a',
      name: 'OpenRouter',
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
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-or-v1-test');
    expect(env.ANTHROPIC_API_KEY).toBe('');
    expect(config.apiKeyHelper).toBeUndefined();
    expect(config.model).toBe('anthropic/claude-sonnet-4.6');
  });

  it('openrouter respects user baseUrl override', () => {
    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-00000000000c',
      name: 'OpenRouter Custom',
      type: 'openrouter',
      apiKey: 'sk-or-v1-test',
      baseUrl: 'https://proxy.example.com',
      models: [{ name: 'anthropic/claude-sonnet-4.6', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-00000000000d',
      name: 'OR Custom',
      models: [{ providerId: openrouterProvider.id, model: 'anthropic/claude-sonnet-4.6', tier: 'base' }],
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
      models: [{ name: 'llama-3.1-70b-instruct', capabilities: { image: true, video: false, audio: false } }],
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

  it('writeConfig sets 0o600 file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-cc-test-'));
    try {
      const config = adapter.buildConfig(singleModelProfile, [testProvider]);
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.claude', 'settings.json');
      const info = await stat(filePath);
      // eslint-disable-next-line no-bitwise
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
