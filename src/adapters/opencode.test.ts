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
  models: ['claude-3-opus'],
};

const testProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Test Profile',
  models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'claude-3-opus' }],
};

describe('OpenCodeAdapter', () => {
  it('buildConfig returns correct model and provider', () => {
    const config = adapter.buildConfig(testProfile, [testProvider]);
    expect(config.model).toBe('claude-3-opus');
    const provider = config.provider as Record<string, unknown>;
    expect('anthropic' in provider).toBe(true);
    const anthropic = provider.anthropic as Record<string, unknown>;
    expect(anthropic.apiKey).toBe('sk-ant-test123');
    const options = anthropic.options as Record<string, string>;
    expect(options.baseURL).toBe('https://api.test.com');
  });

  it('buildConfig without baseUrl omits options', () => {
    const providerNoUrl = { ...testProvider, baseUrl: undefined };
    const config = adapter.buildConfig(testProfile, [providerNoUrl]);
    const provider = config.provider as Record<string, unknown>;
    const anthropic = provider.anthropic as Record<string, unknown>;
    expect('options' in anthropic).toBe(false);
  });

  it('buildConfig throws if provider not found', () => {
    expect(() => adapter.buildConfig(testProfile, [])).toThrow('Provider not found');
  });

  it('configPaths for openai-compatible uses openai key', () => {
    const openaiProvider = { ...testProvider, type: 'openai-compatible' as const };
    const config = adapter.buildConfig(testProfile, [openaiProvider]);
    const provider = config.provider as Record<string, unknown>;
    expect('openai' in provider).toBe(true);
  });
});
