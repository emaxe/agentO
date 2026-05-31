import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let homeDir = '';
let projectDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => homeDir),
  };
});

function codexPaths(): { global: string; project: string; defaultProfile: string } {
  return {
    global: join(homeDir, '.codex', 'config.toml'),
    project: join(projectDir, '.codex', 'config.toml'),
    defaultProfile: join(homeDir, '.codex', 'default.config.toml'),
  };
}

async function writeToml(path: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), 'utf-8');
}

async function readToml(path: string): Promise<Record<string, unknown>> {
  return parseToml(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function runRestore(): Promise<void> {
  const { createRestoreCommand } = await import('./restore.js');
  await createRestoreCommand().parseAsync(['-a', 'codex', '-s', 'project'], { from: 'user' });
}

describe('restore command Codex multi-file backup', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-restore-home-'));
    projectDir = await mkdtemp(join(tmpdir(), 'agento-restore-project-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('restores all three Codex project files from a crash-like manifest', async () => {
    const paths = codexPaths();
    const originalGlobal = {
      theme: 'light',
      model_providers: { old: { name: 'Old', base_url: 'https://old.test/v1' } },
      default_profile: 'old',
      profiles: { old: { model: 'old-model', model_provider: 'old' } },
    };
    const originalProject = { model: 'old-project-model' };
    const originalProfile = { model: 'old-profile-model', model_provider: 'old' };
    const { writeBackup, backupExists } = await import('../../config/store.js');
    await writeBackup('codex', 'project', {
      cwd: projectDir,
      files: [
        { path: paths.global, format: 'toml', hadFile: true, content: originalGlobal },
        { path: paths.project, format: 'toml', hadFile: true, content: originalProject },
        { path: paths.defaultProfile, format: 'toml', hadFile: true, content: originalProfile },
      ],
    });
    await writeToml(paths.global, { theme: 'light', model_providers: { new: { name: 'New' } } });
    await writeToml(paths.project, { model: 'new-project-model' });
    await writeToml(paths.defaultProfile, { model: 'new-profile-model', model_provider: 'new' });

    await runRestore();

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(await readToml(paths.defaultProfile)).toEqual(originalProfile);
    expect(backupExists('codex', 'project')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('Restored codex config (project)');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('deletes all three Codex project files when the manifest says they did not exist', async () => {
    const paths = codexPaths();
    const { writeBackup, backupExists } = await import('../../config/store.js');
    await writeBackup('codex', 'project', {
      cwd: projectDir,
      files: [
        { path: paths.global, format: 'toml', hadFile: false, content: null },
        { path: paths.project, format: 'toml', hadFile: false, content: null },
        { path: paths.defaultProfile, format: 'toml', hadFile: false, content: null },
      ],
    });
    await writeToml(paths.global, { model_providers: { new: { name: 'New' } } });
    await writeToml(paths.project, { model: 'new-project-model' });
    await writeToml(paths.defaultProfile, { model: 'new-profile-model', model_provider: 'new' });

    await runRestore();

    expect(existsSync(paths.global)).toBe(false);
    expect(existsSync(paths.project)).toBe(false);
    expect(existsSync(paths.defaultProfile)).toBe(false);
    expect(backupExists('codex', 'project')).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
