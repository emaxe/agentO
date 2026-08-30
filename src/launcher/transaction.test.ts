import { unlink } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

vi.mock('../config/store.js', () => ({
  writeBackup: vi.fn(),
  readBackup: vi.fn(),
  deleteBackup: vi.fn().mockResolvedValue(undefined),
  inferBackupFileFormat: vi.fn((path: string) => (path.endsWith('.toml') ? 'toml' : 'json')),
  readConfig: vi.fn().mockResolvedValue({ settings: { mergeAgentConfigs: true } }),
}));

vi.mock('./shell-path-resolver.js', () => ({
  shellPathResolver: {
    resolve: vi.fn().mockResolvedValue('/usr/local/bin:/usr/bin:/bin'),
  },
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
}));

vi.mock('../proxy/openai-proxy.js', () => ({
  startOpenAIProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:9999', stop: vi.fn() }),
}));

vi.mock('../proxy/anthropic-scrubber.js', () => ({
  startAnthropicScrubberProxy: vi
    .fn()
    .mockResolvedValue({ url: 'http://127.0.0.1:9998', stop: vi.fn() }),
}));

vi.mock('../proxy/responses-proxy.js', () => ({
  startResponsesProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:19999', stop: vi.fn() }),
}));

import { deleteBackup, readBackup, writeBackup } from '../config/store.js';
import { startOpenAIProxy } from '../proxy/openai-proxy.js';
import { startAnthropicScrubberProxy } from '../proxy/anthropic-scrubber.js';
import { startResponsesProxy } from '../proxy/responses-proxy.js';
import { prepareLaunchTransaction } from './transaction.js';

const mockWriteBackup = vi.mocked(writeBackup);
const mockReadBackup = vi.mocked(readBackup);
const mockDeleteBackup = vi.mocked(deleteBackup);
const mockUnlink = vi.mocked(unlink);
const mockStartOpenAIProxy = vi.mocked(startOpenAIProxy);
const mockStartAnthropicScrubberProxy = vi.mocked(startAnthropicScrubberProxy);
const mockStartResponsesProxy = vi.mocked(startResponsesProxy);

const testProvider: Provider = {
  id: 'p1',
  name: 'Test',
  type: 'anthropic-compatible',
  apiKey: 'sk-test',
  baseUrl: 'https://api.test.com',
  models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
};

const testProfile: Profile = {
  id: 'prof1',
  name: 'Test Profile',
  models: [{ providerId: 'p1', model: 'claude-3' }],
};

function makeAdapter(currentConfig: Record<string, unknown> | null = null): AgentAdapter {
  return {
    id: 'test-agent',
    displayName: 'Test Agent',
    supportedProviderTypes: ['anthropic-compatible'],
    readConfig: vi.fn().mockResolvedValue(currentConfig),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    buildConfig: vi.fn().mockReturnValue({ env: { TEST: 'value' } }),
    buildEnv: vi.fn().mockReturnValue({ ADAPTER_KEY: 'adapter-value' }),
    configPaths: vi
      .fn()
      .mockReturnValue({ global: '/home/user/.config/test.json', project: '/project/.test.toml' }),
  };
}

describe('prepareLaunchTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteBackup.mockResolvedValue(undefined);
    mockReadBackup.mockResolvedValue(null);
    mockDeleteBackup.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockStartOpenAIProxy.mockResolvedValue({ url: 'http://127.0.0.1:9999', stop: vi.fn() });
    mockStartAnthropicScrubberProxy.mockResolvedValue({
      url: 'http://127.0.0.1:9998',
      stop: vi.fn(),
    });
    mockStartResponsesProxy.mockResolvedValue({ url: 'http://127.0.0.1:19999', stop: vi.fn() });
  });

  it('writes a v2 backup manifest with cwd, path, format, hadFile, and content', async () => {
    const existingConfig = { model: 'original' };
    const adapter = makeAdapter(existingConfig);

    await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'project',
      command: 'claude',
      cwd: '/project',
    });

    expect(mockWriteBackup).toHaveBeenCalledWith('test-agent', 'project', {
      cwd: '/project',
      files: [
        {
          path: '/project/.test.toml',
          format: 'toml',
          hadFile: true,
          content: existingConfig,
        },
      ],
    });
  });

  it('writes the new config after a successful backup', async () => {
    const adapter = makeAdapter({ model: 'original' });
    mockWriteBackup.mockImplementation(async () => {
      expect(adapter.writeConfig).not.toHaveBeenCalled();
    });

    await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(adapter.buildConfig).toHaveBeenCalledWith(testProfile, [testProvider]);
    expect(adapter.writeConfig).toHaveBeenCalledWith(
      { env: { TEST: 'value' } },
      'global',
      undefined,
      true,
    );
  });

  it('does not write config when an active backup already exists', async () => {
    const adapter = makeAdapter({ model: 'original' });
    mockWriteBackup.mockRejectedValue(
      new Error('Active backup already exists for test-agent (global)'),
    );

    await expect(
      prepareLaunchTransaction({
        adapter,
        profile: testProfile,
        providers: [testProvider],
        scope: 'global',
        command: 'claude',
      }),
    ).rejects.toThrow('Active backup already exists');

    expect(adapter.buildConfig).not.toHaveBeenCalled();
    expect(adapter.writeConfig).not.toHaveBeenCalled();
  });

  it('returns an ExecRequest with resolved PATH, adapter env, command, args, agentId, and profileId', async () => {
    const adapter = makeAdapter(null);

    const { execReq } = await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
      args: ['--verbose'],
    });

    expect(execReq).toMatchObject({
      command: 'claude',
      args: ['--verbose'],
      agentId: 'test-agent',
      profileId: 'prof1',
    });
    expect(execReq.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(execReq.env.ADAPTER_KEY).toBe('adapter-value');
  });

  it('cleanup restores the original config when the backup had a file', async () => {
    const existingConfig = { model: 'original' };
    const adapter = makeAdapter(existingConfig);
    mockReadBackup.mockResolvedValue({
      version: 2,
      sessionId: 'session-1',
      agentId: 'test-agent',
      scope: 'global',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [
        {
          path: '/home/user/.config/test.json',
          format: 'json',
          hadFile: true,
          content: existingConfig,
        },
      ],
    });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    const setupWriteCount = vi.mocked(adapter.writeConfig).mock.calls.length;
    await cleanup();

    expect(adapter.writeConfig).toHaveBeenCalledTimes(setupWriteCount + 1);
    expect(adapter.writeConfig).toHaveBeenLastCalledWith(existingConfig, 'global', undefined);
    expect(mockDeleteBackup).toHaveBeenCalledWith('test-agent', 'global', undefined);
  });

  it('cleanup removes the config path when the backup had no file', async () => {
    const adapter = makeAdapter(null);
    mockReadBackup.mockResolvedValue({
      version: 2,
      sessionId: 'session-1',
      agentId: 'test-agent',
      scope: 'global',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [
        {
          path: '/home/user/.config/test.json',
          format: 'json',
          hadFile: false,
          content: null,
        },
      ],
    });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    const setupWriteCount = vi.mocked(adapter.writeConfig).mock.calls.length;
    await cleanup();

    expect(mockUnlink).toHaveBeenCalledWith('/home/user/.config/test.json');
    expect(adapter.writeConfig).toHaveBeenCalledTimes(setupWriteCount);
    expect(mockDeleteBackup).toHaveBeenCalledWith('test-agent', 'global', undefined);
  });

  it('cleanup tolerates a missing config file when the backup had no file', async () => {
    const adapter = makeAdapter(null);
    const error = new Error('missing') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockUnlink.mockRejectedValue(error);
    mockReadBackup.mockResolvedValue({
      version: 2,
      sessionId: 'session-1',
      agentId: 'test-agent',
      scope: 'global',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [
        {
          path: '/home/user/.config/test.json',
          format: 'json',
          hadFile: false,
          content: null,
        },
      ],
    });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('starts OpenAI proxy for openai-compatible provider with claude-code adapter', async () => {
    const openaiProvider: Provider = {
      id: 'p-openai',
      name: 'OpenAI',
      type: 'openai-compatible',
      apiKey: 'sk-openai',
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const openaiProfile: Profile = {
      id: 'prof-openai',
      name: 'OpenAI Profile',
      models: [{ providerId: openaiProvider.id, model: 'gpt-4' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['openai-compatible'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://api.openai.com/v1' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: openaiProfile,
      providers: [openaiProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartOpenAIProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://api.openai.com/v1' });
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });

  it('starts anthropic scrubber proxy for fireworks provider with claude-code adapter', async () => {
    const fwProvider: Provider = {
      id: 'p-fw',
      name: 'Fireworks',
      type: 'fireworks',
      apiKey: 'fw-key',
      models: [{ name: 'llama-3', capabilities: { image: true, video: false, audio: false } }],
    };
    const fwProfile: Profile = {
      id: 'prof-fw',
      name: 'FW Profile',
      models: [{ providerId: fwProvider.id, model: 'llama-3' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['fireworks'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://api.fireworks.ai/inference' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: fwProfile,
      providers: [fwProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartAnthropicScrubberProxy).toHaveBeenCalledWith({
      upstreamUrl: 'https://api.fireworks.ai/inference',
    });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
  });

  it('starts OpenAI proxy for custom-api provider with openai mode and claude-code adapter', async () => {
    const customProvider: Provider = {
      id: 'p-custom-openai',
      name: 'Custom OpenAI',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: true, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const customProfile: Profile = {
      id: 'prof-custom',
      name: 'Custom Profile',
      models: [{ providerId: customProvider.id, model: 'gpt-4' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['custom-api'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: customProfile,
      providers: [customProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartOpenAIProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://proxy.example.com' });
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });

  it('starts anthropic scrubber proxy for custom-api provider with anthropic mode and claude-code adapter', async () => {
    const customProvider: Provider = {
      id: 'p-custom-anthropic',
      name: 'Custom Anthropic',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: true, responses: false },
      models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
    };
    const customProfile: Profile = {
      id: 'prof-custom-anth',
      name: 'Custom Anthropic Profile',
      models: [{ providerId: customProvider.id, model: 'claude-3' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['custom-api'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com/v1' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: customProfile,
      providers: [customProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartAnthropicScrubberProxy).toHaveBeenCalledWith({
      upstreamUrl: 'https://proxy.example.com/v1',
    });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
  });

  it('starts responses proxy for responses-compatible provider with claude-code adapter', async () => {
    const responsesProvider: Provider = {
      id: 'p-responses',
      name: 'OpenAI Responses',
      type: 'responses-compatible',
      apiKey: 'sk-resp',
      baseUrl: 'https://api.openai.com',
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const responsesProfile: Profile = {
      id: 'prof-responses',
      name: 'Responses Profile',
      models: [{ providerId: responsesProvider.id, model: 'gpt-4o' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['responses-compatible'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://api.openai.com' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: responsesProfile,
      providers: [responsesProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartResponsesProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://api.openai.com' });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });

  it('starts responses proxy for custom-api provider with responses mode', async () => {
    const customProvider: Provider = {
      id: 'p-custom-resp',
      name: 'Custom Responses',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: true },
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const customProfile: Profile = {
      id: 'prof-custom-resp',
      name: 'Custom Responses Profile',
      models: [{ providerId: customProvider.id, model: 'gpt-4o' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['custom-api'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: customProfile,
      providers: [customProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartResponsesProxy).toHaveBeenCalledWith({
      upstreamUrl: 'https://proxy.example.com',
    });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });
});
