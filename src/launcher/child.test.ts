import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

// Mock dependencies before importing the module under test
vi.mock('../platform/spawn.js', () => ({
  spawnCommand: vi.fn(),
}));

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

// Spy on killTree but keep the real POSIX behaviour (`child.kill`); win32 would spawn taskkill.
vi.mock('../platform/kill-tree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/kill-tree.js')>();
  return { killTree: vi.fn(actual.killTree) };
});

import { writeBackup, readBackup } from '../config/store.js';
import { unlink } from 'node:fs/promises';
import { killTree } from '../platform/kill-tree.js';
import { spawnCommand } from '../platform/spawn.js';
import { launchChild, prepareChild } from './child.js';

const mockWriteBackup = vi.mocked(writeBackup);
const mockReadBackup = vi.mocked(readBackup);
const mockUnlink = vi.mocked(unlink);
const mockSpawn = vi.mocked(spawnCommand);
const mockKillTree = vi.mocked(killTree);

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
    readConfig: vi.fn().mockResolvedValue(currentConfig),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    buildConfig: vi.fn().mockReturnValue({ env: { TEST: 'value' } }),
    configPaths: vi
      .fn()
      .mockReturnValue({ global: '/home/user/.config/test.json', project: '/project/.test.json' }),
  } as unknown as AgentAdapter;
}

function makeFakeChildProcess(): EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  pid: number;
} {
  return Object.assign(new EventEmitter(), { kill: vi.fn(() => true), pid: 4321 });
}

/** Fires the process-level handler agento registered for `signal`. */
function raise(signal: NodeJS.Signals): void {
  for (const listener of process.listeners(signal)) {
    (listener as (s: string) => void)(signal);
  }
}

describe('prepareChild', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.clearAllMocks();
    mockWriteBackup.mockResolvedValue(undefined);
    mockReadBackup.mockResolvedValue(null);
    mockUnlink.mockResolvedValue(undefined);
    mockSpawn.mockReset();
  });

  afterEach(() => {});

  it('backs up current config before writing new one', async () => {
    const existingConfig = { mcpServers: {} };
    const adapter = makeAdapter(existingConfig);

    await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockWriteBackup).toHaveBeenCalledWith('test-agent', 'global', {
      cwd: undefined,
      pid: process.pid,
      pidStartedAt: expect.any(String) as string,
      files: [
        {
          path: '/home/user/.config/test.json',
          format: 'json',
          hadFile: true,
          content: existingConfig,
        },
      ],
    });
    expect(adapter.writeConfig).toHaveBeenCalledTimes(1);
  });

  it('records hadFile=false when no config exists', async () => {
    const adapter = makeAdapter(null);

    await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockWriteBackup).toHaveBeenCalledWith('test-agent', 'global', {
      cwd: undefined,
      pid: process.pid,
      pidStartedAt: expect.any(String) as string,
      files: [
        {
          path: '/home/user/.config/test.json',
          format: 'json',
          hadFile: false,
          content: null,
        },
      ],
    });
  });

  it('does not write new config when active backup already exists', async () => {
    const adapter = makeAdapter({ original: true });
    mockWriteBackup.mockRejectedValue(
      new Error('Active backup already exists for test-agent (global)'),
    );

    await expect(
      prepareChild({
        adapter,
        profile: testProfile,
        providers: [testProvider],
        scope: 'global',
        command: 'claude',
      }),
    ).rejects.toThrow('Active backup already exists');

    expect(adapter.writeConfig).not.toHaveBeenCalled();
  });

  it('returns ExecRequest with resolved PATH and correct command', async () => {
    const adapter = makeAdapter(null);

    const { execReq } = await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
    });

    expect(execReq.command).toBe('claude');
    expect(execReq.args).toEqual(['--dangerously-skip-permissions']);
    expect(execReq.env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('cleanup restores original config when it existed', async () => {
    const existingConfig = { mcpServers: { myServer: {} } };
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

    const { cleanup } = await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    await cleanup();

    expect(mockReadBackup).toHaveBeenCalledWith('test-agent', 'global', undefined);
    expect(adapter.writeConfig).toHaveBeenCalledWith(existingConfig, 'global', undefined);
  });

  it('cleanup deletes config file when no original config existed', async () => {
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

    const { cleanup } = await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    const callsBefore = vi.mocked(adapter.writeConfig).mock.calls.length;
    await cleanup();

    expect(mockUnlink).toHaveBeenCalledWith('/home/user/.config/test.json');
    // writeConfig should not be called again during cleanup (only the initial setup call)
    expect(vi.mocked(adapter.writeConfig).mock.calls.length).toBe(callsBefore);
  });

  it('cleanup tolerates unlink failure when config file was already removed', async () => {
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

    const { cleanup } = await prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('launchChild spawns with the prepared ExecRequest and cleans up on exit', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    const launch = launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
      args: ['--verbose'],
      cwd: '/project',
    });

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    expect(mockSpawn).toHaveBeenCalledWith('claude', ['--verbose'], {
      stdio: 'inherit',
      cwd: '/project',
      shell: false,
      env: expect.objectContaining({
        PATH: '/usr/local/bin:/usr/bin:/bin',
      }) as Record<string, string>,
    });

    child.emit('exit', 7);

    await expect(launch).resolves.toBe(7);
    expect(mockReadBackup).toHaveBeenCalledWith('test-agent', 'global', '/project');
  });

  it('launchChild cleans up on spawn error and returns failure', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    const launch = launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit('error', new Error('boom'));

    await expect(launch).resolves.toBe(1);
    expect(mockReadBackup).toHaveBeenCalledWith('test-agent', 'global', undefined);
    expect(consoleError).toHaveBeenCalledWith('Failed to launch claude:', 'boom');

    consoleError.mockRestore();
  });
  it('forwards a signal to the agent and waits for it to exit before restoring config', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    void launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    raise('SIGINT');

    // The agent is still alive: restoring its config now would race with
    // whatever it is writing, so nothing may have been read back yet.
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
    expect(mockReadBackup).not.toHaveBeenCalled();

    child.emit('exit', 130);
    await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
  });

  it('restores the config only once when a signal is followed by the agent exiting', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    void launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    raise('SIGTERM');
    child.emit('exit', 143);
    child.emit('exit', 143);

    await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
    expect(mockReadBackup).toHaveBeenCalledTimes(1);
  });

  it('escalates to SIGKILL when a second signal arrives', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    void launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    raise('SIGINT');
    raise('SIGINT');

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

    child.emit('exit', null);
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
  });

  it('escalates to SIGKILL when the agent ignores the signal past the grace period', async () => {
    vi.useFakeTimers();
    try {
      const adapter = makeAdapter(null);
      const child = makeFakeChildProcess();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

      void launchChild({
        adapter,
        profile: testProfile,
        providers: [testProvider],
        scope: 'global',
        command: 'claude',
      });
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      raise('SIGTERM');
      expect(child.kill).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // Let the launch settle so its handlers are unregistered.
      child.emit('exit', null);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalled());
    } finally {
      vi.useRealTimers();
    }
  });

  it('unregisters its signal handlers once the agent has exited', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);

    const before = process.listenerCount('SIGINT');
    const launch = launchChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    expect(process.listenerCount('SIGINT')).toBe(before + 1);

    child.emit('exit', 0);
    await launch;

    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});

describe('launchChild signal handling', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.clearAllMocks();
    mockWriteBackup.mockResolvedValue(undefined);
    mockReadBackup.mockResolvedValue(null);
    mockUnlink.mockResolvedValue(undefined);
    mockSpawn.mockReset();
    mockKillTree.mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  async function start(platform: NodeJS.Platform) {
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawnCommand>);
    const launch = launchChild({
      adapter: makeAdapter(null),
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
      platform,
    });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    return { child, launch };
  }

  describe('win32', () => {
    it('ignores the first SIGINT: the agent got the same Ctrl+C from the console', async () => {
      const { child, launch } = await start('win32');

      raise('SIGINT');

      expect(mockKillTree).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('Press Ctrl+C again to force quit.');
      expect(mockReadBackup).not.toHaveBeenCalled();

      // The agent handled Ctrl+C itself and exited: a normal exit, not a forced one.
      child.emit('exit', 0);
      await expect(launch).resolves.toBe(0);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('force-kills the process tree on a second SIGINT within 3 s', async () => {
      vi.useFakeTimers();
      const { child } = await start('win32');

      raise('SIGINT');
      await vi.advanceTimersByTimeAsync(2_999);
      raise('SIGINT');

      expect(mockKillTree).toHaveBeenCalledExactlyOnceWith(child, 'force', 'win32');
      // Config is restored only after the agent has actually exited.
      expect(mockReadBackup).not.toHaveBeenCalled();

      child.emit('exit', 1);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
    });

    it('treats a second SIGINT after the 3 s window as a new first one', async () => {
      vi.useFakeTimers();
      const { child } = await start('win32');

      raise('SIGINT');
      await vi.advanceTimersByTimeAsync(3_001);
      raise('SIGINT');

      expect(mockKillTree).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(2);

      child.emit('exit', 0);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
    });

    it.each(['SIGBREAK', 'SIGHUP'] as const)(
      '%s kills the tree at once and restores the config exactly once',
      async (signal) => {
        const { child } = await start('win32');

        raise(signal);
        raise(signal);

        expect(mockKillTree).toHaveBeenCalledExactlyOnceWith(child, 'force', 'win32');

        child.emit('exit', 1);
        child.emit('exit', 1);
        await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
        expect(mockReadBackup).toHaveBeenCalledTimes(1);
      },
    );

    it('does not arm the SIGKILL grace timer', async () => {
      vi.useFakeTimers();
      const { child } = await start('win32');

      raise('SIGHUP');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockKillTree).toHaveBeenCalledTimes(1);
      child.emit('exit', 1);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalled());
    });

    it('does not subscribe to SIGTERM', async () => {
      const before = process.listenerCount('SIGTERM');
      const { child, launch } = await start('win32');

      expect(process.listenerCount('SIGTERM')).toBe(before);

      child.emit('exit', 0);
      await launch;
    });

    it('removes every handler it installed once the agent has exited', async () => {
      const signals = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM'] as const;
      const before = signals.map((signal) => process.listenerCount(signal));
      const { child, launch } = await start('win32');

      child.emit('exit', 0);
      await launch;

      expect(signals.map((signal) => process.listenerCount(signal))).toEqual(before);
    });

    it('cleans up and returns 1 when the agent cannot be started (ENOENT)', async () => {
      const { child, launch } = await start('win32');

      child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
      child.emit('exit', null);

      await expect(launch).resolves.toBe(1);
      expect(mockReadBackup).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('Failed to launch claude:', 'spawn claude ENOENT');
      expect(mockKillTree).not.toHaveBeenCalled();
    });
  });

  describe('POSIX', () => {
    it.each(['linux', 'darwin'] as const)(
      'SIGINT is forwarded with child.kill on %s',
      async (platform) => {
        const { child } = await start(platform);

        raise('SIGINT');

        expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
        expect(consoleError).not.toHaveBeenCalledWith('Press Ctrl+C again to force quit.');

        child.emit('exit', 130);
        await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      },
    );

    it('a second SIGINT escalates to SIGKILL', async () => {
      const { child } = await start('linux');

      raise('SIGINT');
      raise('SIGINT');

      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

      child.emit('exit', null);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
    });

    it('SIGTERM is forwarded and followed by SIGKILL after the 5 s grace period', async () => {
      vi.useFakeTimers();
      const { child } = await start('linux');

      raise('SIGTERM');
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');

      await vi.advanceTimersByTimeAsync(4_999);
      expect(child.kill).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');

      child.emit('exit', null);
      await vi.waitFor(() => expect(mockReadBackup).toHaveBeenCalledTimes(1));
    });

    it('does not subscribe to the Windows-only signals', async () => {
      const before = [process.listenerCount('SIGBREAK'), process.listenerCount('SIGHUP')];
      const { child, launch } = await start('linux');

      expect([process.listenerCount('SIGBREAK'), process.listenerCount('SIGHUP')]).toEqual(before);

      child.emit('exit', 0);
      await launch;
    });
  });
});
