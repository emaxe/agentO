import { describe, it, expect } from 'vitest';
import { ClaudeCodeAdapter } from './claude-code.js';
import type { Profile, Provider } from '../config/schema.js';

const adapter = new ClaudeCodeAdapter();

const testProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Provider',
  type: 'anthropic',
  apiKey: 'sk-ant-test123',
  baseUrl: 'https://api.test.com',
  models: ['claude-3-opus'],
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
      models: ['claude-3-haiku'],
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
});
