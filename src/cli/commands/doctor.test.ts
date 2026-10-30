import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { p } from '../../test-utils/paths.js';
import { createDoctorCommand } from './doctor.js';

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  readUiState: vi.fn(),
  backupExists: vi.fn(),
  listAgents: vi.fn(),
  getAgentInstaller: vi.fn(),
  access: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../../config/store.js', () => ({
  readConfig: mocks.readConfig,
  backupExists: mocks.backupExists,
}));
vi.mock('../../config/ui-state.js', () => ({ readUiState: mocks.readUiState }));
vi.mock('../../agents/registry.js', () => ({
  listAgents: mocks.listAgents,
  getAgentInstaller: mocks.getAgentInstaller,
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  access: mocks.access,
}));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));

const savedExitCode = process.exitCode;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.readConfig.mockResolvedValue({ providers: [{ apiKey: 'secret-key' }], profiles: [{}] });
  mocks.readUiState.mockResolvedValue({});
  mocks.backupExists.mockReturnValue(false);
  mocks.listAgents.mockReturnValue([{ id: 'claude-code' }, { id: 'qwen' }]);
  mocks.getAgentInstaller.mockReturnValue(undefined);
  mocks.access.mockResolvedValue(undefined);
  mocks.existsSync.mockReturnValue(true);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = savedExitCode;
});

async function report() {
  await createDoctorCommand().parseAsync(['--json'], { from: 'user' });
  return JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
}

describe('agento doctor', () => {
  it('reports configuration counts and paths without exposing credentials', async () => {
    const result = await report();
    expect(result).toMatchObject({
      configOk: true,
      providers: 1,
      profiles: 1,
      configWritable: true,
      configDirExists: true,
      activeBackups: [],
      installedAgents: [
        { id: 'claude-code', installed: false },
        { id: 'qwen', installed: false },
      ],
    });
    expect(result.configPath).toBe(p(result.configDir, 'config.json'));
    expect(result.uiStatePath).toBe(p(result.configDir, 'ui-state.json'));
    expect(JSON.stringify(result)).not.toContain('secret-key');
    expect(process.exitCode).toBe(0);
  });

  it('returns diagnostics and exit code 1 for a corrupt config', async () => {
    mocks.readConfig.mockRejectedValue(new Error('Invalid JSON'));
    expect(await report()).toMatchObject({
      configOk: false,
      configError: 'Invalid JSON',
      providers: 0,
      profiles: 0,
    });
    expect(mocks.getAgentInstaller).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('handles a non-Error config failure', async () => {
    mocks.readConfig.mockRejectedValue('unreadable');
    expect(await report()).toMatchObject({ configOk: false, configError: 'unreadable' });
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing, unwritable config directory', async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.access.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await report()).toMatchObject({ configDirExists: false, configWritable: false });
  });

  it('reports backups for both scopes using the current directory', async () => {
    mocks.backupExists.mockImplementation(
      (id: string, scope: string) =>
        (id === 'claude-code' && scope === 'global') || (id === 'qwen' && scope === 'project'),
    );
    expect((await report()).activeBackups).toEqual([
      { agentId: 'claude-code', scope: 'global' },
      { agentId: 'qwen', scope: 'project' },
    ]);
    expect(mocks.backupExists).toHaveBeenCalledWith('qwen', 'project', process.cwd());
  });

  it('keeps reporting other agents when an installation probe fails', async () => {
    mocks.getAgentInstaller.mockImplementation((id: string) => ({
      checkInstalled: () =>
        id === 'qwen'
          ? Promise.reject(new Error('probe failed'))
          : Promise.resolve({ installed: true, version: '1.2.3' }),
    }));
    expect((await report()).installedAgents).toEqual([
      { id: 'claude-code', installed: true, version: '1.2.3' },
      { id: 'qwen', installed: false },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('prints the last launch, backups and installed versions in text mode', async () => {
    mocks.readUiState.mockResolvedValue({
      lastLaunch: { profileId: 'work', agentId: 'qwen', mode: 'child', scope: 'project' },
    });
    mocks.backupExists.mockImplementation(
      (id: string, scope: string) => id === 'qwen' && scope === 'project',
    );
    mocks.getAgentInstaller.mockReturnValue({
      checkInstalled: async () => ({ installed: true, version: '1.2.3' }),
    });
    await createDoctorCommand().parseAsync([], { from: 'user' });
    const output = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => line)
      .join('\n');
    expect(output).toContain('work → qwen (child, project)');
    expect(output).toContain('qwen[project]');
    expect(output).toContain('qwen v1.2.3');
    expect(output).not.toContain('secret-key');
    expect(process.exitCode).toBe(0);
  });
});
