import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

// Mock dependencies before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

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

import { writeBackup, readBackup } from '../config/store.js';
import { unlink } from 'node:fs/promises';
import { launchChild, prepareChild } from './child.js';

const mockWriteBackup = vi.mocked(writeBackup);
const mockReadBackup = vi.mocked(readBackup);
const mockUnlink = vi.mocked(unlink);
const mockSpawn = vi.mocked(spawn);

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
    configPaths: vi.fn().mockReturnValue({ global: '/home/user/.config/test.json', project: '/project/.test.json' }),
  } as unknown as AgentAdapter;
}

function makeFakeChildProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
}

/** Fires the process-level handler agento registered for `signal`. */
function raise(signal: 'SIGINT' | 'SIGTERM'): void {
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

  afterEach(() => {
  });

  it('backs up current config before writing new one', async () => {
    const existingConfig = { mcpServers: {} };
    const adapter = makeAdapter(existingConfig);

    await prepareChild({ adapter, profile: testProfile, providers: [testProvider], scope: 'global', command: 'claude' });

    expect(mockWriteBackup).toHaveBeenCalledWith('test-agent', 'global', {
      cwd: undefined,
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: true,
        content: existingConfig,
      }],
    });
    expect(adapter.writeConfig).toHaveBeenCalledTimes(1);
  });

  it('records hadFile=false when no config exists', async () => {
    const adapter = makeAdapter(null);

    await prepareChild({ adapter, profile: testProfile, providers: [testProvider], scope: 'global', command: 'claude' });

    expect(mockWriteBackup).toHaveBeenCalledWith('test-agent', 'global', {
      cwd: undefined,
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: false,
        content: null,
      }],
    });
  });

  it('does not write new config when active backup already exists', async () => {
    const adapter = makeAdapter({ original: true });
    mockWriteBackup.mockRejectedValue(new Error('Active backup already exists for test-agent (global)'));

    await expect(prepareChild({
      adapter,
      profile: testProfile,
      providers: [testProvider],
      scope: 'global',
      command: 'claude',
    })).rejects.toThrow('Active backup already exists');

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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: true,
        content: existingConfig,
      }],
    });

    const { cleanup } = await prepareChild({ adapter, profile: testProfile, providers: [testProvider], scope: 'global', command: 'claude' });
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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: false,
        content: null,
      }],
    });

    const { cleanup } = await prepareChild({ adapter, profile: testProfile, providers: [testProvider], scope: 'global', command: 'claude' });
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
      files: [{
        path: '/home/user/.config/test.json',
        format: 'json',
        hadFile: false,
        content: null,
      }],
    });

    const { cleanup } = await prepareChild({ adapter, profile: testProfile, providers: [testProvider], scope: 'global', command: 'claude' });

    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('launchChild spawns with the prepared ExecRequest and cleans up on exit', async () => {
    const adapter = makeAdapter(null);
    const child = makeFakeChildProcess();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

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
