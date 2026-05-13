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

function codexPaths(): { global: string; project: string } {
  return {
    global: join(homeDir, '.codex', 'config.toml'),
    project: join(projectDir, '.codex', 'config.toml'),
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
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('backs up global and project Codex files, writes both, and cleanup restores both', async () => {
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
      default_profile: 'old',
      profiles: { old: { model: 'old-global-model', model_provider: 'existing' } },
    };
    const originalProject = { model: 'old-project-model' };
    await writeToml(paths.global, originalGlobal);
    await writeToml(paths.project, originalProject);

    const { cleanup } = await prepareCodexProject();

    const { readBackup, backupExists } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.path)).toEqual([paths.global, paths.project]);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([true, true]);

    const globalDuringLaunch = await readToml(paths.global);
    expect(globalDuringLaunch.theme).toBe('dark');
    expect(globalDuringLaunch.model_providers).toHaveProperty('fireworks-ai');
    expect(globalDuringLaunch.default_profile).toBe('default');
    expect(await readToml(paths.project)).toEqual({ model: 'accounts/fireworks/models/kimi-k2' });

    await cleanup();

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(backupExists('codex', 'project', projectDir)).toBe(false);
  });

  it('cleanup deletes both Codex files when neither existed before launch', async () => {
    const paths = codexPaths();

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([false, false]);
    expect(existsSync(paths.global)).toBe(true);
    expect(existsSync(paths.project)).toBe(true);

    await cleanup();

    expect(existsSync(paths.global)).toBe(false);
    expect(existsSync(paths.project)).toBe(false);
  });

  it('cleanup restores existing global config and deletes a newly-created project config', async () => {
    const paths = codexPaths();
    const originalGlobal = { notify: ['terminal'], default_profile: 'old' };
    await writeToml(paths.global, originalGlobal);

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([true, false]);

    await cleanup();

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(existsSync(paths.project)).toBe(false);
  });

  it('cleanup deletes a newly-created global config and restores existing project config', async () => {
    const paths = codexPaths();
    const originalProject = { model: 'original-project-model' };
    await writeToml(paths.project, originalProject);

    const { cleanup } = await prepareCodexProject();

    const { readBackup } = await import('../config/store.js');
    const backup = await readBackup('codex', 'project', projectDir);
    expect(backup?.files.map((file) => file.hadFile)).toEqual([false, true]);

    await cleanup();

    expect(existsSync(paths.global)).toBe(false);
    expect(await readToml(paths.project)).toEqual(originalProject);
  });

  it('does not write either Codex file when an active project backup already exists', async () => {
    const paths = codexPaths();
    const originalGlobal = { preserve: true };
    const originalProject = { model: 'original-project-model' };
    await writeToml(paths.global, originalGlobal);
    await writeToml(paths.project, originalProject);

    const { writeBackup } = await import('../config/store.js');
    await writeBackup('codex', 'project', {
      cwd: projectDir,
      files: [{
        path: paths.global,
        format: 'toml',
        hadFile: true,
        content: originalGlobal,
      }],
    });

    await expect(prepareCodexProject()).rejects.toThrow('Active backup already exists');

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
  });
});
