/**
 * Tests for restoreBackupForAgent — the read → restore-all-files → delete
 * pipeline shared by the TUI Agents screen (and mirroring `agento restore`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'agento-restore-fn-'));
});

afterEach(async () => {
  await (await import('node:fs/promises')).rm(testDir, { recursive: true, force: true });
});

describe('restoreBackupForAgent', () => {
  it('returns false and changes nothing when no backup exists', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { getAgent } = await import('../agents/registry.js');
    const codex = getAgent('codex', { dev: true })!.adapter;

    const restored = await restoreBackupForAgent(codex, 'global');
    expect(restored).toBe(false);
  });

  it('restores every file of a multi-file manifest and deletes the backup', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, backupExists } = await import('./store.js');
    const { getAgent } = await import('../agents/registry.js');

    const cwd = await (await import('node:fs/promises')).mkdtemp(join(testDir, 'project-'));
    const globalFile = join(testDir, '.codex', 'config.toml');
    const projectFile = join(cwd, '.codex', 'config.toml');
    await mkdir(join(testDir, '.codex'), { recursive: true });
    await mkdir(join(cwd, '.codex'), { recursive: true });
    await writeFile(globalFile, 'theme = "patched"\n');
    await writeFile(projectFile, 'model = "patched"\n');

    const originalGlobal = { theme: 'original-global' };
    const originalProject = { model: 'original-project' };
    await writeBackup('codex', 'project', {
      cwd,
      files: [
        { path: globalFile, format: 'toml', hadFile: true, content: originalGlobal },
        { path: projectFile, format: 'toml', hadFile: true, content: originalProject },
      ],
    });

    const codex = getAgent('codex', { dev: true })!.adapter;
    const restored = await restoreBackupForAgent(codex, 'project', cwd);

    expect(restored).toBe(true);
    expect(await readFile(globalFile, 'utf-8')).toContain('original-global');
    expect(await readFile(projectFile, 'utf-8')).toContain('original-project');
    expect(backupExists('codex', 'project', cwd)).toBe(false);
  });

  it('removes the config file when the single-file manifest records hadFile: false', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, backupExists } = await import('./store.js');
    const { getAgent } = await import('../agents/registry.js');

    const claude = getAgent('claude-code')!.adapter;
    const configPath = claude.configPaths(testDir).global;
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(configPath, JSON.stringify({ env: { PATCHED: '1' } }));
    expect(existsSync(configPath)).toBe(true);

    await writeBackup('claude-code', 'global', {
      files: [{ path: configPath, format: 'json', hadFile: false, content: null }],
    });

    const restored = await restoreBackupForAgent(claude, 'global', testDir);
    expect(restored).toBe(true);
    expect(existsSync(configPath)).toBe(false);
    expect(backupExists('claude-code', 'global')).toBe(false);
  });
});
