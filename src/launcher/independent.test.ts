import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

vi.mock('../config/store.js', () => ({
  writeBackup: vi.fn(),
  readBackup: vi.fn(),
  deleteBackup: vi.fn(),
  inferBackupFileFormat: vi.fn((path: string) => path.endsWith('.toml') ? 'toml' : 'json'),
}));

vi.mock('./shell-path-resolver.js', () => ({
  shellPathResolver: {
    resolve: vi.fn().mockResolvedValue('/usr/local/bin:/usr/bin:/bin'),
  },
}));

import { writeBackup } from '../config/store.js';
import { launchIndependent } from './independent.js';

const mockWriteBackup = vi.mocked(writeBackup);

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
    supportedProviderTypes: [],
    readConfig: vi.fn().mockResolvedValue(currentConfig),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    buildConfig: vi.fn().mockReturnValue({ env: { TEST: 'value' } }),
    configPaths: vi.fn().mockReturnValue({ global: '/home/user/.config/test.json', project: '/project/.test.json' }),
  } as unknown as AgentAdapter;
}

describe('launchIndependent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteBackup.mockResolvedValue(undefined);
  });

  it('writes a v2 backup manifest before writing new config', async () => {
    const existingConfig = { model: 'original' };
    const adapter = makeAdapter(existingConfig);

    await launchIndependent({
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
        path: '/project/.test.json',
        format: 'json',
        hadFile: true,
        content: existingConfig,
      }],
    });
    expect(adapter.writeConfig).toHaveBeenCalledTimes(1);
  });

  it('does not write new config when active backup already exists', async () => {
    const adapter = makeAdapter({ model: 'original' });
    mockWriteBackup.mockRejectedValue(new Error('Active backup already exists for test-agent (global)'));

    await expect(launchIndependent({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    })).rejects.toThrow('Active backup already exists');

    expect(adapter.writeConfig).not.toHaveBeenCalled();
  });

  it('returns an ExecRequest from the shared transaction path', async () => {
    const adapter = makeAdapter(null);

    const execReq = await launchIndependent({
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
    expect(execReq.cleanup).toBeUndefined();
    expect(adapter.writeConfig).toHaveBeenCalledTimes(1);
  });
});
