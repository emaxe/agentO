import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

let testDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => testDir),
  };
});

beforeEach(async () => {
  vi.resetModules();
  // Re-acquire the actual tmpdir after resetModules
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function getStore() {
  return await import('./store.js');
}

describe('config store', () => {
  it('readConfig returns default config when file does not exist', async () => {
    const { readConfig } = await getStore();
    const config = await readConfig();
    expect(config.providers).toEqual([]);
    expect(config.profiles).toEqual([]);
    expect(config.settings.defaultLaunchMode).toBe('child');
    expect(config.settings.defaultConfigScope).toBe('global');
  });

  it('writeConfig then readConfig returns same value', async () => {
    const { readConfig, writeConfig } = await getStore();
    const initial = await readConfig();
    initial.settings.defaultLaunchMode = 'independent';
    await writeConfig(initial);
    const read = await readConfig();
    expect(read.settings.defaultLaunchMode).toBe('independent');
  });

  it('writeBackup writes and readBackup returns a v2 manifest', async () => {
    const { writeBackup, readBackup, getBackupPath } = await getStore();
    const content = { apiKey: 'test-key', model: 'test-model' };
    await writeBackup('claude-code', 'global', {
      cwd: '/tmp/project',
      sessionId: 'session-1',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [{
        path: '/home/user/.claude/settings.json',
        format: 'json',
        hadFile: true,
        content,
      }],
    });

    const result = await readBackup('claude-code', 'global');
    expect(result).toEqual({
      version: 2,
      sessionId: 'session-1',
      agentId: 'claude-code',
      scope: 'global',
      cwd: '/tmp/project',
      createdAt: '2026-05-13T00:00:00.000Z',
      files: [{
        path: '/home/user/.claude/settings.json',
        format: 'json',
        hadFile: true,
        content,
      }],
    });

    const { readFile } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const raw = JSON.parse(await readFile(getBackupPath('claude-code', 'global'), 'utf-8')) as Record<string, unknown>;
    expect(raw.version).toBe(2);
    expect(raw.sessionId).toBe('session-1');
    expect(raw.createdAt).toBe('2026-05-13T00:00:00.000Z');
    expect(raw.agentId).toBe('claude-code');
    expect(raw.scope).toBe('global');
  });

  it('readBackup returns null when no backup exists', async () => {
    const { readBackup } = await getStore();
    const result = await readBackup('claude-code', 'global');
    expect(result).toBeNull();
  });

  it('backupExists returns false when no backup, true after writeBackup', async () => {
    const { backupExists, writeBackup } = await getStore();
    expect(backupExists('opencode', 'project')).toBe(false);
    await writeBackup('opencode', 'project', {
      files: [{ path: '/project/opencode.json', hadFile: true, content: { test: true } }],
    });
    expect(backupExists('opencode', 'project')).toBe(true);
  });

  it('deleteBackup removes backup file so backupExists returns false', async () => {
    const { writeBackup, deleteBackup, backupExists } = await getStore();
    await writeBackup('claude-code', 'global', {
      files: [{ path: '/home/user/.claude/settings.json', hadFile: true, content: { test: true } }],
    });
    expect(backupExists('claude-code', 'global')).toBe(true);
    await deleteBackup('claude-code', 'global');
    expect(backupExists('claude-code', 'global')).toBe(false);
  });

  it('deleteBackup does not throw when backup does not exist', async () => {
    const { deleteBackup } = await getStore();
    await expect(deleteBackup('claude-code', 'global')).resolves.toBeUndefined();
  });

  it('readBackup normalizes legacy raw backups to v2-like manifests', async () => {
    const { readBackup, getBackupPath } = await getStore();
    const { writeFile, mkdir } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const backupPath = getBackupPath('qwen', 'global');
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, JSON.stringify({ legacy: true }), 'utf-8');

    const result = await readBackup('qwen', 'global');

    expect(result).toMatchObject({
      version: 2,
      sessionId: 'legacy',
      agentId: 'qwen',
      scope: 'global',
      files: [{
        path: '',
        format: 'json',
        hadFile: true,
        content: { legacy: true },
      }],
    });
  });

  it('writeBackup does not overwrite an existing active backup', async () => {
    const { writeBackup } = await getStore();
    await writeBackup('qwen', 'project', {
      files: [{ path: '/project/.qwen/settings.json', hadFile: true, content: { original: true } }],
    });

    await expect(writeBackup('qwen', 'project', {
      files: [{ path: '/project/.qwen/settings.json', hadFile: true, content: { overwritten: true } }],
    })).rejects.toThrow('agento restore -a qwen -s project');
  });

  it('writeConfig creates file with valid JSON content', async () => {
    const { writeConfig } = await getStore();
    const { readFile: fsReadFile } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const config = { providers: [], profiles: [], settings: { defaultLaunchMode: 'child', defaultConfigScope: 'global' } };
    await writeConfig(config as Parameters<typeof writeConfig>[0]);
    const content = JSON.parse(await fsReadFile(join(testDir, '.agento', 'config.json'), 'utf-8')) as unknown;
    expect(content).toMatchObject({ providers: [], profiles: [] });
  });

  it('writeConfig twice overwrites without error', async () => {
    const { readConfig, writeConfig } = await getStore();
    const initial = await readConfig();
    initial.settings.defaultLaunchMode = 'independent';
    await writeConfig(initial);
    initial.settings.defaultLaunchMode = 'child';
    await writeConfig(initial);
    const result = await readConfig();
    expect(result.settings.defaultLaunchMode).toBe('child');
  });

  it('writeConfig cleans up temp file when rename fails', async () => {
    // Skip on Windows: EISDIR behaviour differs
    if (process.platform === 'win32') return;
    const { mkdir: fsMkdir, readdir: fsReaddir } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const configDir = join(testDir, '.agento');
    const configPath = join(configDir, 'config.json');

    // Make CONFIG_PATH a directory → rename(tmp, dir) fails with EISDIR on POSIX
    await fsMkdir(configPath, { recursive: true });

    // Get a valid AgentOConfig without reading the (now-directory) config path
    const { AgentOConfigSchema } = await import('./schema.js');
    const config = AgentOConfigSchema.parse({});

    const { writeConfig } = await getStore();
    await expect(writeConfig(config)).rejects.toThrow();

    // No temp files should remain in the config dir
    const entries = await fsReaddir(configDir);
    expect(entries.filter((e) => e.includes('.tmp-'))).toHaveLength(0);
  });

  it('writeConfig sets 0o600 file mode on POSIX', async () => {
    if (process.platform === 'win32') return;
    const { writeConfig, readConfig } = await getStore();
    const config = await readConfig();
    await writeConfig(config);
    const configPath = join(testDir, '.agento', 'config.json');
    const { stat: fsStat } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const info = await fsStat(configPath);
    // eslint-disable-next-line no-bitwise
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('migrates old string[] models to ModelConfig[] on read', async () => {
    const { readConfig } = await getStore();
    // Write a config with old string[] format manually
    const { writeFile, mkdir } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await mkdir(join(testDir, '.agento'), { recursive: true });
    const oldConfig = {
      providers: [{
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test',
        type: 'anthropic',
        apiKey: 'key123',
        models: ['claude-3-opus', 'claude-3-sonnet'],
      }],
      profiles: [],
      settings: {},
    };
    await writeFile(join(testDir, '.agento', 'config.json'), JSON.stringify(oldConfig), 'utf-8');

    const config = await readConfig();
    expect(config.providers).toHaveLength(1);
    const models = config.providers[0]!.models;
    expect(models[0]).toEqual({ name: 'claude-3-opus', capabilities: { image: true, video: false, audio: false } });
    expect(models[1]).toEqual({ name: 'claude-3-sonnet', capabilities: { image: true, video: false, audio: false } });
  });
});
