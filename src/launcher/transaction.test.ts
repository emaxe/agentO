import { unlink } from 'node:fs/promises';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

vi.mock('../config/store.js', () => ({
  writeBackup: vi.fn(),
  readBackup: vi.fn(),
  deleteBackup: vi.fn().mockResolvedValue(undefined),
  inferBackupFileFormat: vi.fn((path: string) => path.endsWith('.toml') ? 'toml' : 'json'),
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

import { deleteBackup, readBackup, writeBackup } from '../config/store.js';
import { prepareLaunchTransaction } from './transaction.js';

const mockWriteBackup = vi.mocked(writeBackup);
const mockReadBackup = vi.mocked(readBackup);
const mockDeleteBackup = vi.mocked(deleteBackup);
const mockUnlink = vi.mocked(unlink);

const testProvider: Provider = {
  id: 'p1',
  name: 'Test',
  type: 'anthropic',
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
    supportedProviderTypes: ['anthropic'],
    readConfig: vi.fn().mockResolvedValue(currentConfig),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    buildConfig: vi.fn().mockReturnValue({ env: { TEST: 'value' } }),
    buildEnv: vi.fn().mockReturnValue({ ADAPTER_KEY: 'adapter-value' }),
    configPaths: vi.fn().mockReturnValue({ global: '/home/user/.config/test.json', project: '/project/.test.toml' }),
  };
}

describe('prepareLaunchTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteBackup.mockResolvedValue(undefined);
    mockReadBackup.mockResolvedValue(null);
    mockDeleteBackup.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
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
      files: [{
        path: '/project/.test.toml',
        format: 'toml',
        hadFile: true,
        content: existingConfig,
      }],
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
    expect(adapter.writeConfig).toHaveBeenCalledWith({ env: { TEST: 'value' } }, 'global', undefined, true);
  });

  it('does not write config when an active backup already exists', async () => {
    const adapter = makeAdapter({ model: 'original' });
    mockWriteBackup.mockRejectedValue(new Error('Active backup already exists for test-agent (global)'));

    await expect(prepareLaunchTransaction({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    })).rejects.toThrow('Active backup already exists');

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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: true,
        content: existingConfig,
      }],
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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: false,
        content: null,
      }],
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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: false,
        content: null,
      }],
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
});
