vi.mock('../config/config-operation.js', () => ({
  withConfigOperation: async (operation: () => Promise<unknown>) => operation(),
  assertConfigFilesAvailable: vi.fn().mockResolvedValue(undefined),
}));

import { unlink } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

vi.mock('../config/store.js', () => ({
  writeBackup: vi.fn(),
  readBackup: vi.fn(),
  backupExists: vi.fn(() => false),
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

// Only the server-starting function is mocked; the pure routing helpers
// (`collectProxyUpstreams`, `shouldProxyModel`) must stay real so tests
// exercise the actual model/baseUrl qualification rule.
vi.mock('../proxy/openai-param-proxy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../proxy/openai-param-proxy.js')>()),
  startOpenAIParamProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:7777', stop: vi.fn() }),
}));

vi.mock('../config/git-exclude.js', () => ({
  addToGitExclude: vi.fn().mockResolvedValue({ added: [] }),
}));

import { addToGitExclude } from '../config/git-exclude.js';
import { deleteBackup, readBackup, writeBackup } from '../config/store.js';
import { startOpenAIProxy } from '../proxy/openai-proxy.js';
import { startAnthropicScrubberProxy } from '../proxy/anthropic-scrubber.js';
import { startResponsesProxy } from '../proxy/responses-proxy.js';
import { startOpenAIParamProxy } from '../proxy/openai-param-proxy.js';
import { buildLaunchEnv, prepareLaunchTransaction } from './transaction.js';

const mockWriteBackup = vi.mocked(writeBackup);
const mockReadBackup = vi.mocked(readBackup);
const mockDeleteBackup = vi.mocked(deleteBackup);
const mockAddToGitExclude = vi.mocked(addToGitExclude);
const mockUnlink = vi.mocked(unlink);
const mockStartOpenAIProxy = vi.mocked(startOpenAIProxy);
const mockStartAnthropicScrubberProxy = vi.mocked(startAnthropicScrubberProxy);
const mockStartResponsesProxy = vi.mocked(startResponsesProxy);
const mockStartOpenAIParamProxy = vi.mocked(startOpenAIParamProxy);

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

const qwenUpstreamProvider: Provider = {
  id: 'p-qwen',
  name: 'Qwen Upstream',
  type: 'openai-compatible',
  apiKey: 'sk-qwen',
  baseUrl: 'https://api.openai.com/v1',
  models: [{ name: 'gpt-6.1-terra', capabilities: { image: true, video: false, audio: false } }],
};

const qwenUpstreamProfile: Profile = {
  id: 'prof-qwen',
  name: 'Qwen Profile',
  models: [{ providerId: qwenUpstreamProvider.id, model: 'gpt-6.1-terra' }],
};

/** A Qwen-shaped modelProviders entry, mirroring QwenAdapter.buildConfig. */
function qwenEntry(model: string, baseUrl: string) {
  const envKey = `QWEN_CUSTOM_API_KEY_OPENAI_${baseUrl
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;
  return {
    id: model,
    name: model,
    baseUrl,
    envKey,
    generationConfig: { modalities: { image: true, video: false, audio: false } },
  };
}

function makeQwenAdapter(config: Record<string, unknown>): AgentAdapter {
  return {
    id: 'qwen',
    displayName: 'Qwen CLI',
    supportedProviderTypes: ['openai-compatible'],
    readConfig: vi.fn().mockResolvedValue(null),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    buildConfig: vi.fn().mockReturnValue(config),
    configPaths: vi.fn().mockReturnValue({
      global: '/home/user/.qwen/settings.json',
      project: '/project/.qwen/settings.json',
    }),
  };
}

/** Reads the patched (second) writeConfig call's modelProviders entry. */
function patchedEntry(
  adapter: AgentAdapter,
  providerKey: string,
  index: number,
): Record<string, unknown> {
  const calls = vi.mocked(adapter.writeConfig).mock.calls;
  const written = calls[1]?.[0] as
    { modelProviders?: Record<string, Array<Record<string, unknown>>> } | undefined;
  return written?.modelProviders?.[providerKey]?.[index] ?? {};
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
    mockStartOpenAIParamProxy.mockResolvedValue({ url: 'http://127.0.0.1:7777', stop: vi.fn() });
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
      pid: process.pid,
      pidStartedAt: expect.any(String) as string,
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

  it('never backs up, writes or git-excludes config for env-only adapters', async () => {
    const adapter = makeAdapter({ model: 'user-owned' });
    adapter.envOnly = true;

    const { execReq, cleanup, warnings } = await prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'project',
      command: 'copilot',
      cwd: '/project',
    });

    expect(mockWriteBackup).not.toHaveBeenCalled();
    expect(adapter.buildConfig).not.toHaveBeenCalled();
    expect(adapter.writeConfig).not.toHaveBeenCalled();
    expect(mockAddToGitExclude).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
    // The environment still carries the adapter's variables — that is the config.
    expect(execReq.env.ADAPTER_KEY).toBe('adapter-value');

    await cleanup();
    expect(mockReadBackup).not.toHaveBeenCalled();
    expect(mockDeleteBackup).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
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

  it('routes needing models through the parameter proxy and keeps envKey', async () => {
    const entry = qwenEntry('gpt-6.1-terra', 'https://api.openai.com/v1');
    const adapter = makeQwenAdapter({
      env: { [entry.envKey]: 'sk-qwen' },
      security: { auth: { selectedType: 'openai' } },
      model: { name: entry.id },
      modelProviders: { openai: [entry] },
      $version: 4,
    });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: qwenUpstreamProfile,
      providers: [qwenUpstreamProvider],
      scope: 'global',
      command: 'qwen',
    });

    expect(mockStartOpenAIParamProxy).toHaveBeenCalledTimes(1);
    expect(mockStartOpenAIParamProxy).toHaveBeenCalledWith({
      upstreamUrl: 'https://api.openai.com/v1',
    });

    const writeConfig = vi.mocked(adapter.writeConfig);
    // First call writes the generated config, second call the patched one.
    expect(writeConfig).toHaveBeenCalledTimes(2);
    expect(writeConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: { name: 'gpt-6.1-terra' },
        security: { auth: { selectedType: 'openai' } },
        modelProviders: {
          openai: [
            expect.objectContaining({
              id: 'gpt-6.1-terra',
              baseUrl: 'http://127.0.0.1:7777/v1',
              envKey: 'QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_API_OPENAI_COM_V1',
              generationConfig: { modalities: { image: true, video: false, audio: false } },
            }),
          ],
        },
      }),
      'global',
      undefined,
      false,
    );

    await cleanup();
  });

  it('preserves a custom upstream path when rewriting baseUrl', async () => {
    const launch = async (baseUrl: string): Promise<unknown> => {
      const adapter = makeQwenAdapter({
        modelProviders: { openai: [qwenEntry('gpt-6', baseUrl)] },
      });
      const { cleanup } = await prepareLaunchTransaction({
        adapter,
        profile: qwenUpstreamProfile,
        providers: [qwenUpstreamProvider],
        scope: 'global',
        command: 'qwen',
      });
      const baseUrlAfter = patchedEntry(adapter, 'openai', 0).baseUrl;
      await cleanup();
      return baseUrlAfter;
    };

    expect(await launch('https://openrouter.ai/api/v1')).toBe('http://127.0.0.1:7777/api/v1');
    expect(await launch('https://openrouter.ai/api/v1/')).toBe('http://127.0.0.1:7777/api/v1');
  });

  it('leaves models that do not need the proxy on their direct baseUrl', async () => {
    const adapter = makeQwenAdapter({
      modelProviders: { openai: [qwenEntry('qwen3.8-max', 'https://dashscope.example.com/v1')] },
    });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: qwenUpstreamProfile,
      providers: [qwenUpstreamProvider],
      scope: 'global',
      command: 'qwen',
    });

    expect(mockStartOpenAIParamProxy).not.toHaveBeenCalled();
    // Only the initial generated-config write happened; no patched rewrite.
    const writeConfig = vi.mocked(adapter.writeConfig);
    expect(writeConfig).toHaveBeenCalledTimes(1);
    const written = writeConfig.mock.calls[0][0] as {
      modelProviders: Record<string, Array<{ baseUrl: unknown }>>;
    };
    expect(written.modelProviders.openai[0].baseUrl).toBe('https://dashscope.example.com/v1');

    await cleanup();
  });

  it('starts one proxy per distinct upstream and stops all on cleanup', async () => {
    const openai = qwenEntry('gpt-6', 'https://api.openai.com/v1');
    const openrouter = qwenEntry('gpt-6.1', 'https://openrouter.ai/api/v1');
    const adapter = makeQwenAdapter({ modelProviders: { openai: [openai, openrouter] } });

    const stops = [vi.fn(), vi.fn()];
    mockStartOpenAIParamProxy
      .mockResolvedValueOnce({ url: 'http://127.0.0.1:7001', stop: stops[0] })
      .mockResolvedValueOnce({ url: 'http://127.0.0.1:7002', stop: stops[1] });

    const { cleanup } = await prepareLaunchTransaction({
      adapter,
      profile: qwenUpstreamProfile,
      providers: [qwenUpstreamProvider],
      scope: 'global',
      command: 'qwen',
    });

    expect(mockStartOpenAIParamProxy).toHaveBeenCalledTimes(2);
    expect(mockStartOpenAIParamProxy).toHaveBeenNthCalledWith(1, {
      upstreamUrl: 'https://api.openai.com/v1',
    });
    expect(mockStartOpenAIParamProxy).toHaveBeenNthCalledWith(2, {
      upstreamUrl: 'https://openrouter.ai/api/v1',
    });
    expect(patchedEntry(adapter, 'openai', 0).baseUrl).toBe('http://127.0.0.1:7001/v1');
    expect(patchedEntry(adapter, 'openai', 1).baseUrl).toBe('http://127.0.0.1:7002/api/v1');

    await cleanup();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(stops[1]).toHaveBeenCalledTimes(1);
  });

  it('fails the launch when a parameter proxy cannot start', async () => {
    const adapter = makeQwenAdapter({
      modelProviders: { openai: [qwenEntry('gpt-6', 'https://api.openai.com/v1')] },
    });
    mockStartOpenAIParamProxy.mockRejectedValue(new Error('proxy boom'));

    // The whole transaction rejects: no exec request is resolved and no
    // patched config is written (only the initial generated-config write).
    await expect(
      prepareLaunchTransaction({
        adapter,
        profile: qwenUpstreamProfile,
        providers: [qwenUpstreamProvider],
        scope: 'global',
        command: 'qwen',
      }),
    ).rejects.toThrow('proxy boom');

    expect(vi.mocked(adapter.writeConfig)).toHaveBeenCalledTimes(1);
  });
});

describe('buildLaunchEnv', () => {
  it('POSIX: matches the previous { ...env, PATH, ...adapterEnv } layout', () => {
    const base = { HOME: '/home/u', PATH: '/old', Path: 'keep' };
    const env = buildLaunchEnv(base, '/new', { ADAPTER_KEY: 'v' }, 'linux');
    expect(env).toEqual({ HOME: '/home/u', PATH: '/new', Path: 'keep', ADAPTER_KEY: 'v' });
    expect(Object.keys(env)).toEqual(['HOME', 'PATH', 'Path', 'ADAPTER_KEY']);
  });

  it('POSIX: lets the adapter override PATH', () => {
    const env = buildLaunchEnv({ PATH: '/old' }, '/resolved', { PATH: '/adapter' }, 'linux');
    expect(env['PATH']).toBe('/adapter');
  });

  it('win32: Path from the process env and the resolved PATH collapse into one key', () => {
    const env = buildLaunchEnv(
      { Path: 'C:\\old', SystemRoot: 'C:\\Windows' },
      'C:\\new',
      {},
      'win32',
    );
    expect(env).toEqual({ Path: 'C:\\new', SystemRoot: 'C:\\Windows' });
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toHaveLength(1);
  });

  it('win32: an adapter PATH override replaces the single key', () => {
    const env = buildLaunchEnv(
      { Path: 'C:\\old' },
      'C:\\resolved',
      { PATH: 'C:\\adapter' },
      'win32',
    );
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['Path']);
    expect(env['Path']).toBe('C:\\adapter');
  });

  it('POSIX: appends loopback to both NO_PROXY spellings independently', () => {
    const env = buildLaunchEnv(
      { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: 'corp.local', no_proxy: 'other' },
      '/bin',
      {},
      'linux',
    );
    expect(env['NO_PROXY']).toBe('corp.local,127.0.0.1,localhost,::1');
    expect(env['no_proxy']).toBe('other,127.0.0.1,localhost,::1');
  });

  it('POSIX: leaves NO_PROXY alone without any proxy variable', () => {
    const env = buildLaunchEnv({ NO_PROXY: 'corp.local' }, '/bin', {}, 'linux');
    expect(env['NO_PROXY']).toBe('corp.local');
    expect(env['no_proxy']).toBeUndefined();
  });

  it('win32: finds a lowercase proxy var and appends loopback to NO_PROXY exactly once', () => {
    const env = buildLaunchEnv(
      { https_proxy: 'http://proxy:3128', No_Proxy: 'corp.local' },
      'C:\\bin',
      {},
      'win32',
    );
    expect(env).toMatchObject({ No_Proxy: 'corp.local,127.0.0.1,localhost,::1' });
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'no_proxy')).toEqual([
      'No_Proxy',
    ]);
  });
});
