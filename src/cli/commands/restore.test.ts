import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../../adapters/base.js';
import { createRestoreCommand } from './restore.js';

type MockAdapter = AgentAdapter & {
  writeConfig: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  function makeAdapter(id: string, displayName: string, dev = false) {
    return {
      id,
      displayName,
      dev,
      supportedProviderTypes: [],
      configPaths: vi.fn(),
      readConfig: vi.fn(),
      buildConfig: vi.fn(),
      writeConfig: vi.fn(),
    };
  }

  const adapters = {
    'claude-code': makeAdapter('claude-code', 'Claude Code'),
    opencode: makeAdapter('opencode', 'OpenCode'),
    qwen: makeAdapter('qwen', 'Qwen CLI'),
    codex: makeAdapter('codex', 'Codex CLI', true),
    copilot: makeAdapter('copilot', 'Copilot CLI'),
    goose: makeAdapter('goose', 'Goose'),
  };

  const agents = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      adapter: adapters['claude-code'],
      command: 'claude',
    },
    { id: 'opencode', label: 'OpenCode', adapter: adapters.opencode, command: 'opencode' },
    { id: 'qwen', label: 'Qwen CLI', adapter: adapters.qwen, command: 'qwen' },
    { id: 'codex', label: 'Codex CLI', adapter: adapters.codex, command: 'codex' },
    { id: 'copilot', label: 'Copilot CLI', adapter: adapters.copilot, command: 'copilot' },
    { id: 'goose', label: 'Goose', adapter: adapters.goose, command: 'goose' },
  ];

  return {
    adapters,
    agents,
    backupExists: vi.fn(),
    readBackup: vi.fn(),
    deleteBackup: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('../../agents/registry.js', () => ({
  listAgents: vi.fn((options: { dev?: boolean } = {}) =>
    mocks.agents.filter((agent) => options.dev || !agent.adapter.dev),
  ),
  getAgent: vi.fn((id: string, options: { dev?: boolean } = {}) =>
    mocks.agents.find((agent) => agent.id === id && (options.dev || !agent.adapter.dev)),
  ),
}));

vi.mock('../../config/store.js', () => ({
  backupExists: mocks.backupExists,
  readBackup: mocks.readBackup,
  deleteBackup: mocks.deleteBackup,
}));

vi.mock('node:fs/promises', () => ({
  unlink: mocks.unlink,
}));

const supportedAgents = 'claude-code, opencode, qwen, codex, copilot, goose';

async function runRestore(args: string[]): Promise<void> {
  const command = createRestoreCommand();
  await command.parseAsync(args, { from: 'user' });
}

function adapter(id: keyof typeof mocks.adapters): MockAdapter {
  return mocks.adapters[id] as MockAdapter;
}

describe('restore command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue('/test/cwd');

    mocks.backupExists.mockReturnValue(true);
    mocks.readBackup.mockResolvedValue({
      version: 2,
      sessionId: 'session-1',
      agentId: 'qwen',
      scope: 'global',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [
        {
          path: '/home/user/.qwen/settings.json',
          format: 'json',
          hadFile: true,
          content: { restored: true },
        },
      ],
    });
    mocks.deleteBackup.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
    for (const mockAdapter of Object.values(mocks.adapters)) {
      mockAdapter.writeConfig.mockResolvedValue(undefined);
      mockAdapter.configPaths.mockReturnValue({
        global: `/home/user/.config/${mockAdapter.id}.json`,
        project: `/project/.config/${mockAdapter.id}.json`,
      });
    }

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores a non-legacy agent through the registry', async () => {
    await runRestore(['-a', 'qwen', '-s', 'global']);

    expect(mocks.backupExists).toHaveBeenCalledWith('qwen', 'global', '/test/cwd');
    expect(adapter('qwen').writeConfig).toHaveBeenCalledWith(
      { restored: true },
      'global',
      '/test/cwd',
    );
    expect(mocks.deleteBackup).toHaveBeenCalledWith('qwen', 'global', '/test/cwd');
    expect(logSpy).toHaveBeenCalledWith('Restored qwen config (global)');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('restores a dev agent without a restore-specific dev flag', async () => {
    await runRestore(['-a', 'codex', '-s', 'project']);

    expect(adapter('codex').writeConfig).toHaveBeenCalledWith(
      { restored: true },
      'project',
      '/test/cwd',
    );
    expect(mocks.deleteBackup).toHaveBeenCalledWith('codex', 'project', '/test/cwd');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('prints the registry ordered agent list for an unknown agent', async () => {
    await runRestore(['-a', 'unknown-agent', '-s', 'global']);

    expect(errorSpy).toHaveBeenCalledWith(
      `Error: Unknown agent: unknown-agent. Supported: ${supportedAgents}`,
    );
    expect(mocks.backupExists).not.toHaveBeenCalled();
    expect(adapter('qwen').writeConfig).not.toHaveBeenCalled();
    expect(mocks.deleteBackup).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects invalid scope before reading backup or writing config', async () => {
    await runRestore(['-a', 'qwen', '-s', 'workspace']);

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Invalid scope: workspace. Supported: global, project',
    );
    expect(mocks.backupExists).not.toHaveBeenCalled();
    expect(mocks.readBackup).not.toHaveBeenCalled();
    expect(adapter('qwen').writeConfig).not.toHaveBeenCalled();
    expect(mocks.deleteBackup).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('deletes backup after a successful writeConfig', async () => {
    await runRestore(['-a', 'opencode', '-s', 'project']);

    expect(adapter('opencode').writeConfig).toHaveBeenCalledWith(
      { restored: true },
      'project',
      '/test/cwd',
    );
    expect(mocks.deleteBackup).toHaveBeenCalledWith('opencode', 'project', '/test/cwd');
    expect(adapter('opencode').writeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteBackup.mock.invocationCallOrder[0],
    );
  });

  it('does not write config or delete backup when no backup exists', async () => {
    mocks.backupExists.mockReturnValue(false);

    await runRestore(['-a', 'qwen', '-s', 'global']);

    expect(errorSpy).toHaveBeenCalledWith('Error: No backup found for qwen (global)');
    expect(mocks.readBackup).not.toHaveBeenCalled();
    expect(adapter('qwen').writeConfig).not.toHaveBeenCalled();
    expect(mocks.deleteBackup).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('deletes config path and backup when manifest hadFile=false', async () => {
    mocks.readBackup.mockResolvedValue({
      version: 2,
      sessionId: 'session-1',
      agentId: 'qwen',
      scope: 'project',
      cwd: '/project',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [
        {
          path: '/project/.qwen/settings.json',
          format: 'json',
          hadFile: false,
          content: null,
        },
      ],
    });

    await runRestore(['-a', 'qwen', '-s', 'project']);

    expect(mocks.unlink).toHaveBeenCalledWith('/project/.qwen/settings.json');
    expect(adapter('qwen').writeConfig).not.toHaveBeenCalled();
    expect(mocks.deleteBackup).toHaveBeenCalledWith('qwen', 'project', '/test/cwd');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('restores legacy-normalized backup through writeConfig and deletes backup', async () => {
    mocks.readBackup.mockResolvedValue({
      version: 2,
      sessionId: 'legacy',
      agentId: 'qwen',
      scope: 'global',
      createdAt: '1970-01-01T00:00:00.000Z',
      files: [
        {
          path: '',
          format: 'json',
          hadFile: true,
          content: { legacy: true },
        },
      ],
    });

    await runRestore(['-a', 'qwen', '-s', 'global']);

    expect(adapter('qwen').writeConfig).toHaveBeenCalledWith(
      { legacy: true },
      'global',
      '/test/cwd',
    );
    expect(mocks.deleteBackup).toHaveBeenCalledWith('qwen', 'global', '/test/cwd');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
