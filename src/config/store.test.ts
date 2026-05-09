import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

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

  it('writeBackup then readBackup returns backup', async () => {
    const { writeBackup, readBackup } = await getStore();
    const content = { apiKey: 'test-key', model: 'test-model' };
    await writeBackup('claude-code', 'global', content);
    const result = await readBackup('claude-code', 'global');
    expect(result).toEqual(content);
  });

  it('readBackup returns null when no backup exists', async () => {
    const { readBackup } = await getStore();
    const result = await readBackup('claude-code', 'global');
    expect(result).toBeNull();
  });

  it('backupExists returns false when no backup, true after writeBackup', async () => {
    const { backupExists, writeBackup } = await getStore();
    expect(backupExists('opencode', 'project')).toBe(false);
    await writeBackup('opencode', 'project', { test: true });
    expect(backupExists('opencode', 'project')).toBe(true);
  });

  it('deleteBackup removes backup file so backupExists returns false', async () => {
    const { writeBackup, deleteBackup, backupExists } = await getStore();
    await writeBackup('claude-code', 'global', { test: true });
    expect(backupExists('claude-code', 'global')).toBe(true);
    await deleteBackup('claude-code', 'global');
    expect(backupExists('claude-code', 'global')).toBe(false);
  });

  it('deleteBackup does not throw when backup does not exist', async () => {
    const { deleteBackup } = await getStore();
    await expect(deleteBackup('claude-code', 'global')).resolves.toBeUndefined();
  });
});
