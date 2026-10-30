import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile, Provider } from '../config/schema.js';

let homeDir = '';
let projectDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

beforeEach(async () => {
  vi.resetModules();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  homeDir = await mkdtemp(join(tmpdir(), 'agento-preview-home-'));
  projectDir = await mkdtemp(join(tmpdir(), 'agento-preview-project-'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme',
  type: 'openai-compatible',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }],
};

const profile: Profile = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'work',
  models: [{ providerId: provider.id, model: 'm1' }],
};

describe('describeLaunch', () => {
  it('lists project files, git-exclude patterns and env variable names without writing', async () => {
    const { openCodeAdapter } = await import('../adapters/opencode.js');
    const { describeLaunch, describePreviewLines } = await import('./preview.js');
    await mkdir(join(projectDir, '.git'), { recursive: true });

    const preview = await describeLaunch({
      adapter: openCodeAdapter,
      agentLabel: 'OpenCode',
      profile,
      providers: [provider],
      mode: 'child',
      scope: 'project',
      cwd: projectDir,
    });

    const configPath = join(projectDir, 'opencode.json');
    expect(preview.files).toEqual([{ path: configPath, action: 'create' }]);
    expect(preview.gitExclude).toEqual(['/opencode.json']);
    expect(preview.envKeys).toEqual([]);
    expect(preview.backup.active).toBe(false);
    expect(existsSync(configPath)).toBe(false);

    const lines = describePreviewLines(preview);
    expect(lines).toContain(`Mode:     child — config is restored when the agent exits`);
    expect(lines).toContain(`  create  ${configPath}`);
  });

  it('reports env-only agents without inventing config files', async () => {
    const { copilotAdapter } = await import('../adapters/copilot.js');
    const { describeLaunch } = await import('./preview.js');

    const preview = await describeLaunch({
      adapter: copilotAdapter,
      profile,
      providers: [provider],
      mode: 'independent',
      scope: 'global',
      cwd: projectDir,
    });

    expect(preview.envOnly).toBe(true);
    expect(preview.files).toEqual([]);
    expect(preview.envKeys).toContain('COPILOT_MODEL');
    expect(preview.warnings.some((warning) => warning.includes('environment variables'))).toBe(
      true,
    );
  });

  it('reports an active backup and a stale one', async () => {
    const { openCodeAdapter } = await import('../adapters/opencode.js');
    const { describeLaunch } = await import('./preview.js');
    const { writeBackup } = await import('../config/store.js');

    await writeBackup('opencode', 'project', {
      cwd: projectDir,
      pid: process.pid,
      files: [{ path: join(projectDir, 'opencode.json'), hadFile: false, content: null }],
    });

    const preview = await describeLaunch({
      adapter: openCodeAdapter,
      profile,
      providers: [provider],
      mode: 'child',
      scope: 'project',
      cwd: projectDir,
    });

    expect(preview.backup.active).toBe(true);
    expect(preview.backup.stale).toBe(false);
    expect(preview.warnings.some((warning) => warning.includes('active backup'))).toBe(true);
  });
});
