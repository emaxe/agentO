import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider, Profile } from '../config/schema.js';

let testDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => testDir) };
});

vi.mock('../launcher/shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn().mockResolvedValue('/usr/bin:/bin') },
}));

beforeEach(async () => {
  vi.resetModules();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-int-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test',
  type: 'anthropic',
  apiKey: 'sk-test',
  models: [{ name: 'claude-3-5-sonnet', capabilities: { image: true, video: false, audio: false } }],
};

const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'default',
  models: [{ providerId: provider.id, model: 'claude-3-5-sonnet' }],
};

describe('launch/restore integration', () => {
  it('1. Full child-mode cycle: config file created then deleted on cleanup', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile,
      providers: [provider],
      scope: 'global',
      command: 'claude',
    });

    const configPath = join(testDir, '.claude', 'settings.json');
    expect(existsSync(configPath)).toBe(true);

    await cleanup();
    expect(existsSync(configPath)).toBe(false);
  });

  it('2. Original config restored after cleanup when file existed before launch', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const configPath = join(testDir, '.claude', 'settings.json');
    const originalConfig = { model: 'original-model', env: {} };
    await mkdir(join(testDir, '.claude'), { recursive: true });
    await writeFile(configPath, JSON.stringify(originalConfig, null, 2), { encoding: 'utf-8', mode: 0o600 });

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile,
      providers: [provider],
      scope: 'global',
      command: 'claude',
    });

    const newContent = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(newContent['model']).toBe('claude-3-5-sonnet');

    await cleanup();

    const restoredContent = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(restoredContent['model']).toBe('original-model');
  });

  it('3. Second launch with active backup throws agento restore error', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile,
      providers: [provider],
      scope: 'global',
      command: 'claude',
    });

    await expect(
      prepareLaunchTransaction({
        adapter: claudeCodeAdapter,
        profile,
        providers: [provider],
        scope: 'global',
        command: 'claude',
      }),
    ).rejects.toThrow('agento restore');
  });

  it('4. Independent mode: backup persists until explicit deleteBackup', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');
    const { backupExists, deleteBackup } = await import('../config/store.js');

    await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile,
      providers: [provider],
      scope: 'global',
      command: 'claude',
    });

    expect(backupExists(claudeCodeAdapter.id, 'global')).toBe(true);
    await deleteBackup(claudeCodeAdapter.id, 'global');
    expect(backupExists(claudeCodeAdapter.id, 'global')).toBe(false);
  });

  it('5. Codex project scope: both TOML files deleted on cleanup (hadFile: false)', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { codexAdapter } = await import('../adapters/codex.js');

    const codexProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Fireworks',
      type: 'fireworks',
      apiKey: 'fw-test',
      models: [{ name: 'llama-3-70b', capabilities: { image: false, video: false, audio: false } }],
    };
    const codexProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'codex-default',
      models: [{ providerId: codexProvider.id, model: 'llama-3-70b' }],
    };

    const cwd = join(testDir, 'project');
    const { cleanup } = await prepareLaunchTransaction({
      adapter: codexAdapter,
      profile: codexProfile,
      providers: [codexProvider],
      scope: 'project',
      command: 'codex',
      cwd,
    });

    const globalToml = join(testDir, '.codex', 'config.toml');
    const projectToml = join(cwd, '.codex', 'config.toml');
    expect(existsSync(globalToml)).toBe(true);
    expect(existsSync(projectToml)).toBe(true);

    await cleanup();

    expect(existsSync(globalToml)).toBe(false);
    expect(existsSync(projectToml)).toBe(false);
  });
});
