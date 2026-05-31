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

vi.mock('../proxy/openai-proxy.js', () => ({
  startOpenAIProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:9999', stop: vi.fn() }),
}));

vi.mock('../proxy/anthropic-scrubber.js', () => ({
  startAnthropicScrubberProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:9998', stop: vi.fn() }),
}));

import { startOpenAIProxy } from '../proxy/openai-proxy.js';
import { startAnthropicScrubberProxy } from '../proxy/anthropic-scrubber.js';
const mockStartOpenAIProxy = vi.mocked(startOpenAIProxy);
const mockStartAnthropicScrubberProxy = vi.mocked(startAnthropicScrubberProxy);

beforeEach(async () => {
  vi.resetModules();
  mockStartOpenAIProxy.mockClear();
  mockStartAnthropicScrubberProxy.mockClear();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-int-test-'));
  process.env.HOME = testDir;
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
  delete process.env.HOME;
});

const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test',
  type: 'anthropic-compatible',
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

  it('5. Claude Code with openrouter provider injects local proxy into config ANTHROPIC_BASE_URL', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const openrouterProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'OpenRouter',
      type: 'openrouter',
      apiKey: 'or-test',
      models: [{ name: 'claude-3-5-sonnet', capabilities: { image: true, video: false, audio: false } }],
    };
    const openrouterProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000006',
      name: 'openrouter-default',
      models: [{ providerId: openrouterProvider.id, model: 'claude-3-5-sonnet' }],
    };

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile: openrouterProfile,
      providers: [openrouterProvider],
      scope: 'global',
      command: 'claude',
    });

    const configPath = join(testDir, '.claude', 'settings.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    const env = config.env as Record<string, string>;
    expect(env['ANTHROPIC_BASE_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mockStartAnthropicScrubberProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://openrouter.ai/api' });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();

    await cleanup();
  });

  it('6. Claude Code with fireworks provider injects local proxy into config ANTHROPIC_BASE_URL', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const fireworksProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000007',
      name: 'Fireworks',
      type: 'fireworks',
      apiKey: 'fw-test',
      models: [{ name: 'accounts/fireworks/models/kimi-k2p6', capabilities: { image: true, video: false, audio: false } }],
    };
    const fireworksProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000008',
      name: 'fireworks-default',
      models: [{ providerId: fireworksProvider.id, model: 'accounts/fireworks/models/kimi-k2p6' }],
    };

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile: fireworksProfile,
      providers: [fireworksProvider],
      scope: 'global',
      command: 'claude',
    });

    const configPath = join(testDir, '.claude', 'settings.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    const env = config.env as Record<string, string>;
    expect(env['ANTHROPIC_BASE_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mockStartAnthropicScrubberProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://api.fireworks.ai/inference' });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();

    await cleanup();
  });

  it('7. Claude Code with anthropic provider does not inject proxy', async () => {
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
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    const env = config.env as Record<string, string>;
    expect(env['ANTHROPIC_BASE_URL']).toBeUndefined();

    await cleanup();
  });

  it('8. Claude Code with openai-compatible provider injects local OpenAI proxy into config ANTHROPIC_BASE_URL', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const openaiProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000014',
      name: 'OpenAI',
      type: 'openai-compatible',
      apiKey: 'sk-openai-test',
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const openaiProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000015',
      name: 'openai-default',
      models: [{ providerId: openaiProvider.id, model: 'gpt-4' }],
    };

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile: openaiProfile,
      providers: [openaiProvider],
      scope: 'global',
      command: 'claude',
    });

    const configPath = join(testDir, '.claude', 'settings.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    const env = config.env as Record<string, string>;
    expect(env['ANTHROPIC_BASE_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mockStartOpenAIProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://api.openai.com/v1' });
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();

    await cleanup();
  });

  it('9. Claude Code with custom-api provider (openai mode) injects local OpenAI proxy into config ANTHROPIC_BASE_URL', async () => {
    const { prepareLaunchTransaction } = await import('./transaction.js');
    const { claudeCodeAdapter } = await import('../adapters/claude-code.js');

    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000016',
      name: 'Custom OpenAI',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: true, anthropic: false, responses: false },
      models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }],
    };
    const customProfile: Profile = {
      id: '00000000-0000-0000-0000-000000000017',
      name: 'custom-openai-default',
      models: [{ providerId: customProvider.id, model: 'gpt-4' }],
    };

    const { cleanup } = await prepareLaunchTransaction({
      adapter: claudeCodeAdapter,
      profile: customProfile,
      providers: [customProvider],
      scope: 'global',
      command: 'claude',
    });

    const configPath = join(testDir, '.claude', 'settings.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    const env = config.env as Record<string, string>;
    expect(env['ANTHROPIC_BASE_URL']).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mockStartOpenAIProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://proxy.example.com' });
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();

    await cleanup();
  });

  it('10. Codex project scope: both TOML files deleted on cleanup (hadFile: false)', async () => {
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
    const profileToml = join(testDir, '.codex', 'default.config.toml');
    expect(existsSync(globalToml)).toBe(true);
    expect(existsSync(projectToml)).toBe(true);
    expect(existsSync(profileToml)).toBe(true);

    await cleanup();

    expect(existsSync(globalToml)).toBe(false);
    expect(existsSync(projectToml)).toBe(false);
    expect(existsSync(profileToml)).toBe(false);
  });
});
