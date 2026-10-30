/**
 * Tests for restoreBackupForAgent — the read → restore-all-files → delete
 * pipeline shared by the TUI Agents screen (and mirroring `agento restore`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../adapters/base.js';

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
  function adapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
    const configPath = join(testDir, 'agent.json');
    return {
      id: 'test-agent',
      displayName: 'Test Agent',
      supportedProviderTypes: ['openai-compatible'],
      configPaths: () => ({ global: configPath, project: configPath }),
      readConfig: async () => null,
      buildConfig: () => ({}),
      writeConfig: vi.fn(async (content) => {
        await writeFile(configPath, JSON.stringify(content));
      }),
      ...overrides,
    };
  }

  it('keeps the backup after a restore failure and permits a successful retry', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, readBackup, backupExists } = await import('./store.js');
    const agent = adapter();
    const configPath = agent.configPaths().global;
    const original = { model: 'original', custom: { keep: true } };
    await writeFile(configPath, JSON.stringify({ model: 'patched' }));
    await writeBackup(agent.id, 'global', {
      files: [{ path: configPath, hadFile: true, content: original }],
    });
    const backup = await readBackup(agent.id, 'global');
    vi.mocked(agent.writeConfig).mockRejectedValueOnce(new Error('File locked'));
    await expect(restoreBackupForAgent(agent, 'global')).rejects.toThrow('File locked');
    expect(await readBackup(agent.id, 'global')).toEqual(backup);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ model: 'patched' });

    await expect(restoreBackupForAgent(agent, 'global')).resolves.toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original);
    expect(agent.writeConfig).toHaveBeenLastCalledWith(original, 'global', undefined);
    expect(backupExists(agent.id, 'global')).toBe(false);
  });

  it('retains all originals when a multi-file restore fails halfway and retries all files', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, readBackup, backupExists } = await import('./store.js');
    const files = ['one.json', 'two.json'].map((name) => ({
      path: join(testDir, name),
      hadFile: true,
      content: { original: name },
    }));
    for (const file of files) await writeFile(file.path, JSON.stringify({ patched: true }));
    let shouldFail = true;
    const agent = adapter({
      restoreConfigFile: vi.fn(async (file) => {
        if (file.path === files[1].path && shouldFail) throw new Error('Second file locked');
        await writeFile(file.path, JSON.stringify(file.content));
      }),
    });
    await writeBackup(agent.id, 'global', { files });
    const backup = await readBackup(agent.id, 'global');
    await expect(restoreBackupForAgent(agent, 'global')).rejects.toThrow('Second file locked');
    expect(await readBackup(agent.id, 'global')).toEqual(backup);
    expect(JSON.parse(await readFile(files[0].path, 'utf8'))).toEqual(files[0].content);
    expect(JSON.parse(await readFile(files[1].path, 'utf8'))).toEqual({ patched: true });
    shouldFail = false;
    await expect(restoreBackupForAgent(agent, 'global')).resolves.toBe(true);
    for (const file of files)
      expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual(file.content);
    expect(agent.restoreConfigFile).toHaveBeenCalledTimes(4);
    expect(agent.writeConfig).not.toHaveBeenCalled();
    expect(backupExists(agent.id, 'global')).toBe(false);
  });

  it('refuses multi-file restore without a file-level hook and leaves files and backup intact', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, backupExists } = await import('./store.js');
    const agent = adapter();
    const files = ['one.json', 'two.json'].map((name) => ({
      path: join(testDir, name),
      hadFile: true,
      content: { original: name },
    }));
    for (const file of files) await writeFile(file.path, JSON.stringify({ patched: true }));
    await writeBackup(agent.id, 'global', { files });
    await expect(restoreBackupForAgent(agent, 'global')).rejects.toThrow(
      'does not support file-level restore',
    );
    expect(agent.writeConfig).not.toHaveBeenCalled();
    for (const file of files)
      expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ patched: true });
    expect(backupExists(agent.id, 'global')).toBe(true);
  });

  it('finishes restoring an already removed generated config', async () => {
    const { restoreBackupForAgent } = await import('./backup-restore.js');
    const { writeBackup, backupExists } = await import('./store.js');
    const agent = adapter();
    await writeBackup(agent.id, 'global', {
      files: [{ path: agent.configPaths().global, hadFile: false, content: null }],
    });
    await expect(restoreBackupForAgent(agent, 'global')).resolves.toBe(true);
    expect(agent.writeConfig).not.toHaveBeenCalled();
    expect(backupExists(agent.id, 'global')).toBe(false);
  });

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
