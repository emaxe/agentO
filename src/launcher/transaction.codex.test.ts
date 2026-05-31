import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, Provider } from '../config/schema.js';

let homeDir = '';
let projectDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => homeDir),
  };
});

vi.mock('./shell-path-resolver.js', () => ({
  shellPathResolver: {
    resolve: vi.fn().mockResolvedValue('/usr/local/bin:/usr/bin:/bin'),
  },
}));

const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Fireworks AI',
  type: 'fireworks',
  apiKey: 'fw-test-key',
  models: [{
    name: 'accounts/fireworks/models/kimi-k2',
    capabilities: { image: true, video: false, audio: false },
  }],
};

const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Codex Profile',
  models: [{ providerId: provider.id, model: 'accounts/fireworks/models/kimi-k2', tier: 'base' }],
};

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

async function prepareCodexProject() {
  const [{ CodexAdapter }, { prepareLaunchTransaction }] = await Promise.all([
    import('../adapters/codex.js'),
    import('./transaction.js'),
  ]);

  return prepareLaunchTransaction({
    adapter: new CodexAdapter(),
    profile,
    providers: [provider],
    scope: 'project',
    command: 'codex',
    args: ['-p', 'default'],
    cwd: projectDir,
  });
}

describe('Codex project launch transaction', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-codex-home-'));
    projectDir = await mkdtemp(join(tmpdir(), 'agento-codex-project-'));
    process.env.HOME = homeDir;
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('backs up all three Codex files, writes all, and cleanup restores all', async () => {
    const paths = codexPaths();
    const originalGlobal = {
      theme: 'dark',
      model_providers: {
        existing: {
          name: 'Existing',
          base_url: 'https://existing.test/v1',
          env_key: 'EXISTING_API_KEY',
          wire_api: 'responses',
        },
      },
      // Legacy profile keys should be stripped during launch, restored on cleanup
      default_profile: 'old',
      profiles: { old: { model: 'old-global-model', model_provider: 'existing' } },
    };
    const originalProject = { model: 'old-project-model' };
    const originalProfile = { model: 'old-profile-model', model_provider: 'old' };
    await writeToml(paths.global, originalGlobal);
    await writeToml(paths.project, originalProject);
    await writeToml(paths.defaultProfile, originalProfile);

    const { cleanup } = await prepareCodexProject();

    const { readBackup, backupExists } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.path)).toEqual([paths.global, paths.project, paths.defaultProfile]);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([true, true, true]);

    // Global config should NOT have legacy profile keys after write
    const globalDuringLaunch = await readToml(paths.global);
    expect(globalDuringLaunch.theme).toBe('dark');
    expect(globalDuringLaunch.model_providers).toHaveProperty('fireworks-ai');
    expect(globalDuringLaunch.default_profile).toBeUndefined();
    expect(globalDuringLaunch.profiles).toBeUndefined();

    // Project config unchanged
    expect(await readToml(paths.project)).toEqual({ model: 'accounts/fireworks/models/kimi-k2' });

    // Profile file has flat model/model_provider
    const profileDuringLaunch = await readToml(paths.defaultProfile);
    expect(profileDuringLaunch.model).toBe('accounts/fireworks/models/kimi-k2');
    expect(profileDuringLaunch.model_provider).toBe('fireworks-ai');
    expect(profileDuringLaunch.profiles).toBeUndefined();
    expect(profileDuringLaunch.default_profile).toBeUndefined();

    await cleanup();

    // All three files restored to original
    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(await readToml(paths.defaultProfile)).toEqual(originalProfile);
    expect(backupExists('codex', 'project', projectDir)).toBe(false);
  });

  it('cleanup deletes all three Codex files when none existed before launch', async () => {
    const paths = codexPaths();

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([false, false, false]);
    expect(existsSync(paths.global)).toBe(true);
    expect(existsSync(paths.project)).toBe(true);
    expect(existsSync(paths.defaultProfile)).toBe(true);

    await cleanup();

    expect(existsSync(paths.global)).toBe(false);
    expect(existsSync(paths.project)).toBe(false);
    expect(existsSync(paths.defaultProfile)).toBe(false);
  });

  it('cleanup restores existing global config and deletes newly-created project/profile configs', async () => {
    const paths = codexPaths();
    const originalGlobal = { notify: ['terminal'], default_profile: 'old' };
    await writeToml(paths.global, originalGlobal);

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([true, false, false]);

    await cleanup();

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(existsSync(paths.project)).toBe(false);
    expect(existsSync(paths.defaultProfile)).toBe(false);
  });

  it('cleanup deletes a newly-created global config, restores existing project config, and deletes newly-created profile config', async () => {
    const paths = codexPaths();
    const originalProject = { model: 'original-project-model' };
    await writeToml(paths.project, originalProject);

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([false, true, false]);

    await cleanup();

    expect(existsSync(paths.global)).toBe(false);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(existsSync(paths.defaultProfile)).toBe(false);
  });

  it('cleanup restores existing profile config and deletes newly-created global/project configs', async () => {
    const paths = codexPaths();
    const originalProfile = { model: 'original-profile-model', model_provider: 'original' };
    await writeToml(paths.defaultProfile, originalProfile);

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([false, false, true]);

    await cleanup();

    expect(existsSync(paths.global)).toBe(false);
    expect(existsSync(paths.project)).toBe(false);
    expect(await readToml(paths.defaultProfile)).toEqual(originalProfile);
  });

  it('does not write either Codex file when an active project backup already exists', async () => {
    const paths = codexPaths();
    const originalGlobal = { preserve: true };
    const originalProject = { model: 'original-project-model' };
    const originalProfile = { model: 'original-profile-model', model_provider: 'original' };
    await writeToml(paths.global, originalGlobal);
    await writeToml(paths.project, originalProject);
    await writeToml(paths.defaultProfile, originalProfile);

    const { writeBackup } = await import('../config/store.js');
    await writeBackup('codex', 'project', {
      cwd: projectDir,
      files: [
        { path: paths.global, format: 'toml', hadFile: true, content: originalGlobal },
        { path: paths.project, format: 'toml', hadFile: true, content: originalProject },
        { path: paths.defaultProfile, format: 'toml', hadFile: true, content: originalProfile },
      ],
    });

    await expect(prepareCodexProject()).rejects.toThrow('Active backup already exists');

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(await readToml(paths.defaultProfile)).toEqual(originalProfile);
  });
});
