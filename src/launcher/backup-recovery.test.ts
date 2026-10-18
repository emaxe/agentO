/**
 * Recovery of a config left patched by an agento that was hard-killed.
 *
 * Runs against the real backup store in a throwaway home directory: the point is
 * that a manifest written by one "session" is picked up (or refused) by the next.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';

let testDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => testDir) };
});

vi.mock('./shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn().mockResolvedValue('/usr/bin') },
}));

const DEAD_PID = 2_000_000_001;
const ORIGINAL = { model: 'original', userSetting: true };
const PATCHED = { model: 'agento-generated' };

const provider: Provider = {
  id: 'p1',
  name: 'Test',
  type: 'anthropic-compatible',
  apiKey: 'sk-test',
  baseUrl: 'https://api.test.com',
  models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }],
};
const profile: Profile = { id: 'prof', name: 'Prof', models: [{ providerId: 'p1', model: 'm' }] };

beforeEach(async () => {
  vi.resetModules();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-recovery-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** An adapter whose "agent config" is one JSON file inside the temp home. */
function makeAdapter() {
  const configPath = join(testDir, 'agent-config.json');
  const writes: unknown[] = [];
  const adapter: AgentAdapter = {
    id: 'test-agent',
    displayName: 'Test Agent',
    supportedProviderTypes: ['anthropic-compatible'],
    configPaths: () => ({ global: configPath, project: configPath }),
    readConfig: async () => {
      try {
        return JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    buildConfig: () => ({ ...PATCHED }),
    writeConfig: vi.fn(async (config: Record<string, unknown>) => {
      writes.push(config);
      await writeFile(configPath, JSON.stringify(config), 'utf-8');
    }),
  };
  return { adapter, configPath, writes };
}

/** Simulates a crashed session: config patched on disk, backup of the original left behind. */
async function leaveCrashedSession(pid: number | undefined) {
  const { adapter, configPath, writes } = makeAdapter();
  const { writeBackup } = await import('../config/store.js');
  await writeBackup('test-agent', 'global', {
    files: [{ path: configPath, format: 'json', hadFile: true, content: ORIGINAL }],
    ...(pid !== undefined ? { pid } : {}),
  });
  await writeFile(configPath, JSON.stringify({ model: 'left-over-patch' }), 'utf-8');
  return { adapter, configPath, writes };
}

async function launch(adapter: AgentAdapter, extra: Record<string, unknown> = {}) {
  const { prepareLaunchTransaction } = await import('./transaction.js');
  return prepareLaunchTransaction({
    adapter,
    profile,
    providers: [provider],
    scope: 'global',
    command: 'agent',
    pid: 4242,
    ...extra,
  });
}

describe('stale backup recovery', () => {
  it('restores a backup whose owner is gone, warns, and continues the launch', async () => {
    const { adapter, writes } = await leaveCrashedSession(DEAD_PID);

    const { warnings, execReq } = await launch(adapter, { isProcessAlive: () => false });

    expect(warnings).toContain('Recovered config from a previous crashed session');
    expect(execReq.warnings).toContain('Recovered config from a previous crashed session');
    // 1st write: the original restored; 2nd: the new launch's config.
    expect(writes).toEqual([ORIGINAL, PATCHED]);
  });

  it('takes a fresh backup of the recovered config, owned by the new launch', async () => {
    const { adapter } = await leaveCrashedSession(DEAD_PID);
    const { readBackup } = await import('../config/store.js');

    await launch(adapter, { isProcessAlive: () => false });

    const manifest = await readBackup('test-agent', 'global');
    expect(manifest?.pid).toBe(4242);
    expect(manifest?.files[0].content).toEqual(ORIGINAL);
  });

  it('probes the pid recorded in the manifest', async () => {
    const { adapter } = await leaveCrashedSession(DEAD_PID);
    const probe = vi.fn(() => false);

    await launch(adapter, { isProcessAlive: probe });

    expect(probe).toHaveBeenCalledExactlyOnceWith(DEAD_PID);
  });

  it('refuses when the recorded process is still alive', async () => {
    const { adapter, writes, configPath } = await leaveCrashedSession(DEAD_PID);
    const { readBackup } = await import('../config/store.js');

    await expect(launch(adapter, { isProcessAlive: () => true })).rejects.toThrow(
      /Active backup already exists for test-agent \(global\)/,
    );

    expect(writes).toEqual([]);
    expect(JSON.parse(await readFile(configPath, 'utf-8'))).toEqual({ model: 'left-over-patch' });
    expect((await readBackup('test-agent', 'global'))?.pid).toBe(DEAD_PID);
  });

  it('refuses a backup written before pids were recorded (backward compatible)', async () => {
    const { adapter, writes } = await leaveCrashedSession(undefined);
    const probe = vi.fn(() => false);

    await expect(launch(adapter, { isProcessAlive: probe })).rejects.toThrow(
      /Active backup already exists/,
    );

    expect(probe).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('does not touch anything when there is no active backup', async () => {
    const { adapter, writes } = makeAdapter();
    const probe = vi.fn(() => false);

    const { warnings } = await launch(adapter, { isProcessAlive: probe });

    expect(probe).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
    expect(writes).toEqual([PATCHED]);
  });

  it('keeps the backup and explains how to recover manually when the restore fails', async () => {
    const { adapter, writes } = await leaveCrashedSession(DEAD_PID);
    vi.mocked(adapter.writeConfig).mockRejectedValueOnce(new Error('EBUSY: file is locked'));
    const { backupExists } = await import('../config/store.js');

    await expect(launch(adapter, { isProcessAlive: () => false })).rejects.toThrow(
      /Could not recover config from a previous crashed session \(EBUSY: file is locked\).*agento restore -a test-agent -s global/,
    );

    expect(backupExists('test-agent', 'global')).toBe(true);
    expect(writes).toEqual([]);
  });

  it('ignores an implausible recorded pid instead of signalling a process group', async () => {
    const { adapter } = await leaveCrashedSession(0);
    const probe = vi.fn(() => false);

    await expect(launch(adapter, { isProcessAlive: probe })).rejects.toThrow(
      /Active backup already exists/,
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it('records the launching process by default', async () => {
    const { adapter } = makeAdapter();
    const { readBackup } = await import('../config/store.js');
    const { prepareLaunchTransaction } = await import('./transaction.js');

    await prepareLaunchTransaction({
      adapter,
      profile,
      providers: [provider],
      scope: 'global',
      command: 'agent',
    });

    const manifest = await readBackup('test-agent', 'global');
    expect(manifest?.pid).toBe(process.pid);
    expect(Date.parse(manifest?.pidStartedAt ?? '')).toBeLessThanOrEqual(Date.now());
  });
});

describe('isProcessAlive', () => {
  it('is true for this process', async () => {
    const { isProcessAlive } = await import('./transaction.js');
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is false for a process that has exited', async () => {
    const { isProcessAlive } = await import('./transaction.js');
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = child.pid;
    if (pid === undefined) throw new Error('child did not start');
    await new Promise((resolve) => child.once('close', resolve));

    expect(isProcessAlive(pid)).toBe(false);
  });

  it('treats EPERM as alive and unknown errors as alive', async () => {
    const { isProcessAlive } = await import('./transaction.js');
    const kill = vi.spyOn(process, 'kill');
    try {
      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      });
      expect(isProcessAlive(1)).toBe(true);

      kill.mockImplementationOnce(() => {
        throw new Error('weird');
      });
      expect(isProcessAlive(1)).toBe(true);

      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      });
      expect(isProcessAlive(1)).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });
});
