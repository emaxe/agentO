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

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'claude-3-opus' }],
};

describe('ClaudeCodeAdapter', () => {
  it('buildConfig returns correct apiKey and baseUrl', () => {
    const config = adapter.buildConfig(testProfile, [testProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test123');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.test.com');
    expect(env.ANTHROPIC_MODEL).toBe('claude-3-opus');
  });

  it('buildConfig without baseUrl omits ANTHROPIC_BASE_URL', () => {
    const providerNoUrl = { ...testProvider, baseUrl: undefined };
    const config = adapter.buildConfig(testProfile, [providerNoUrl]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test123');
    expect('ANTHROPIC_BASE_URL' in env).toBe(false);
  });

  it('buildConfig throws if provider not found', () => {
    expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
  });

  it('configPaths returns correct paths', () => {
    const paths = adapter.configPaths('/my/project');
    expect(paths.project).toContain('.claude/settings.json');
    expect(paths.global).toContain('.claude/settings.json');
  });
});
