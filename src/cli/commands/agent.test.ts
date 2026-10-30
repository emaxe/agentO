import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createAgentCommand } from './agent.js';

const mocks = vi.hoisted(() => ({
  backupExists: vi.fn(),
  checkInstalled: vi.fn(),
  listAgents: vi.fn(),
  getAgentInstaller: vi.fn(),
}));

vi.mock('../../config/store.js', () => ({
  backupExists: mocks.backupExists,
}));

vi.mock('../../agents/registry.js', () => ({
  listAgents: mocks.listAgents,
  getAgentInstaller: mocks.getAgentInstaller,
}));

async function run(args: string[]): Promise<void> {
  await createAgentCommand().parseAsync(args, { from: 'user' });
}

describe('agento agent status', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backupExists.mockImplementation(
      (id: string, scope: string) => id === 'claude-code' && scope === 'global',
    );
    mocks.checkInstalled.mockResolvedValue({ installed: true, version: '1.2.3' });
    mocks.listAgents.mockReturnValue([
      {
        id: 'claude-code',
        label: 'Claude Code',
        command: 'claude',
        adapter: {
          id: 'claude-code',
          displayName: 'Claude Code',
          configPaths: () => ({
            global: '/home/user/.claude/settings.json',
            project: '/project/.claude/settings.json',
          }),
        },
      },
    ]);
    mocks.getAgentInstaller.mockReturnValue({ checkInstalled: mocks.checkInstalled });

    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports installed version and per-scope backup state as JSON', async () => {
    await run(['status', '--json']);

    expect(process.exitCode).toBe(0);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      agents: Array<{
        id: string;
        installed: boolean;
        version?: string;
        scopes: { global: { backup: boolean }; project: { backup: boolean } };
      }>;
    };
    expect(parsed.agents[0]).toMatchObject({
      id: 'claude-code',
      installed: true,
      version: '1.2.3',
      scopes: { global: { backup: true }, project: { backup: false } },
    });
  });

  it('prints a readable status line', async () => {
    await run(['status']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Claude Code (claude-code) v1.2.3');
    expect(output).toContain('global: modified (backup exists)');
    expect(output).toContain('project: original');
  });
});
