import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnCommand, spawnCommandSync } from '../platform/spawn.js';
import { errnoError, fakeChild, syncResult } from '../test-utils/spawn-fakes.js';
import { createCopilotInstaller } from './copilot.js';
import { createGooseInstaller } from './goose.js';
import { createKimiInstaller } from './kimi.js';
import { createOpenCodeInstaller, openCodeInstaller } from './opencode.js';
import { claudeCodeInstaller } from './claude-code.js';
import { codexInstaller } from './codex.js';
import { kiloInstaller } from './kilo.js';
import { piInstaller } from './pi.js';
import { qwenInstaller } from './qwen.js';

vi.mock('../platform/spawn.js', () => ({
  spawnCommand: vi.fn(),
  spawnCommandSync: vi.fn(),
}));

vi.mock('../launcher/shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn().mockResolvedValue('/p'), invalidate: vi.fn() },
}));

/** Makes `spawnCommandSync` succeed only for the listed commands (ENOENT for the rest). */
function onlyAvailable(...commands: string[]): void {
  vi.mocked(spawnCommandSync).mockImplementation((cmd: string) =>
    commands.includes(cmd)
      ? syncResult({ stdout: '1.0.0' })
      : syncResult({ status: null, error: errnoError('ENOENT') }),
  );
}

function spawned(): Array<[string, readonly string[]]> {
  return vi.mocked(spawnCommand).mock.calls.map(([cmd, args]) => [cmd, args]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(spawnCommand).mockImplementation(() => fakeChild(0));
});

describe('npm-based installer configs', () => {
  it('opencode installs opencode-ai (the `opencode` package does not exist on npm)', async () => {
    expect(openCodeInstaller.manualInstructions.commands).toEqual(['npm install -g opencode-ai']);

    await createOpenCodeInstaller({ platform: 'linux' }).install();
    expect(spawned()).toEqual([['npm', ['install', '-g', 'opencode-ai']]]);
  });

  it.each([
    [claudeCodeInstaller, '@anthropic-ai/claude-code'],
    [codexInstaller, '@openai/codex'],
    [kiloInstaller, '@kilocode/cli'],
    [piInstaller, '@earendil-works/pi-coding-agent'],
    [qwenInstaller, '@qwen-code/qwen-code@latest'],
  ])('%# keeps its package name', (installer, pkg) => {
    expect(installer.manualInstructions.commands).toEqual([`npm install -g ${pkg}`]);
  });
});

describe('copilot installer', () => {
  it('darwin: uses brew cask', async () => {
    onlyAvailable('brew');
    const installer = createCopilotInstaller({ platform: 'darwin' });

    expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
    await installer.install();
    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      ['brew', ['install', '--cask', 'copilot-cli']],
      ['brew', ['upgrade', '--cask', 'copilot-cli']],
      ['brew', ['uninstall', '--cask', 'copilot-cli']],
    ]);
    expect(installer.manualInstructions.commands).toEqual(['brew install --cask copilot-cli']);
  });

  it('darwin: reports brew missing', async () => {
    onlyAvailable();
    expect(await createCopilotInstaller({ platform: 'darwin' }).checkEnvironment()).toEqual({
      ok: false,
      missing: ['brew'],
    });
  });

  it('win32: prefers winget', async () => {
    onlyAvailable('winget', 'npm');
    const installer = createCopilotInstaller({ platform: 'win32' });

    await installer.install();
    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      [
        'winget',
        [
          'install',
          '--id',
          'GitHub.Copilot',
          '-e',
          '--accept-source-agreements',
          '--accept-package-agreements',
        ],
      ],
      [
        'winget',
        [
          'upgrade',
          '--id',
          'GitHub.Copilot',
          '-e',
          '--accept-source-agreements',
          '--accept-package-agreements',
        ],
      ],
      ['winget', ['uninstall', '--id', 'GitHub.Copilot', '-e']],
    ]);
  });

  it('win32: falls back to the npm package without winget', async () => {
    onlyAvailable('npm');
    const installer = createCopilotInstaller({ platform: 'win32' });

    expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
    await installer.install();

    expect(spawned()).toEqual([['npm', ['install', '-g', '@github/copilot']]]);
  });

  it('win32: neither winget nor npm → env check fails and install is refused', async () => {
    onlyAvailable();
    const installer = createCopilotInstaller({ platform: 'win32' });

    expect(await installer.checkEnvironment()).toEqual({ ok: false, missing: ['winget', 'npm'] });
    expect((await installer.install()).success).toBe(false);
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it('win32: manual instructions list winget and npm', () => {
    const { commands, windows } = createCopilotInstaller({ platform: 'win32' }).manualInstructions;
    expect(commands).toEqual([
      'winget install --id GitHub.Copilot -e',
      'npm install -g @github/copilot',
    ]);
    expect(windows?.commands).toEqual(commands);
  });

  it('linux: npm only, never brew', async () => {
    onlyAvailable('npm', 'brew');
    const installer = createCopilotInstaller({ platform: 'linux' });

    await installer.install();

    expect(spawned()).toEqual([['npm', ['install', '-g', '@github/copilot']]]);
    expect(installer.manualInstructions.commands).toEqual(['npm install -g @github/copilot']);
  });

  it('parses the Copilot version banner', async () => {
    vi.mocked(spawnCommandSync).mockReturnValue(
      syncResult({ stdout: 'GitHub Copilot CLI 0.0.400\n' }),
    );
    expect(await createCopilotInstaller().checkInstalled()).toEqual({
      installed: true,
      version: '0.0.400',
    });
  });
});

describe('goose installer', () => {
  it('posix: uses brew', async () => {
    onlyAvailable('brew');
    const installer = createGooseInstaller({ platform: 'darwin' });

    expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
    await installer.install();
    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      ['brew', ['install', 'block-goose-cli']],
      ['brew', ['upgrade', 'block-goose-cli']],
      ['brew', ['uninstall', 'block-goose-cli']],
    ]);
    expect(installer.manualInstructions.commands).toEqual(['brew install block-goose-cli']);
  });

  it('win32: manual only — nothing is spawned', async () => {
    onlyAvailable('brew', 'winget', 'npm');
    const installer = createGooseInstaller({ platform: 'win32' });

    expect((await installer.checkEnvironment()).ok).toBe(false);
    for (const result of [
      await installer.install(),
      await installer.update?.(),
      await installer.uninstall?.(),
    ]) {
      expect(result?.success).toBe(false);
      expect(result?.error).toContain('manual');
    }
    expect(spawnCommand).not.toHaveBeenCalled();
    expect(installer.manualInstructions.commands).toEqual([
      'winget search goose',
      '# Releases: https://github.com/block/goose/releases/latest',
    ]);
  });
});

describe('kimi installer', () => {
  it('posix: runs the official script through bash', async () => {
    onlyAvailable('curl');
    const installer = createKimiInstaller({ platform: 'linux' });

    expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
    await installer.install();
    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      ['bash', ['-c', 'curl -LsSf https://code.kimi.com/install.sh | bash']],
      ['bash', ['-c', 'curl -LsSf https://code.kimi.com/install.sh | bash']],
      ['uv', ['tool', 'uninstall', 'kimi-cli']],
    ]);
  });

  it('posix: needs curl or wget', async () => {
    onlyAvailable();
    expect(await createKimiInstaller({ platform: 'linux' }).checkEnvironment()).toEqual({
      ok: false,
      missing: ['curl', 'wget'],
    });
  });

  it('win32: installs, upgrades and removes through uv — never bash or curl', async () => {
    onlyAvailable('uv', 'bash', 'curl');
    const installer = createKimiInstaller({ platform: 'win32' });

    expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
    await installer.install();
    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      ['uv', ['tool', 'install', '--python', '3.13', 'kimi-cli']],
      ['uv', ['tool', 'upgrade', 'kimi-cli']],
      ['uv', ['tool', 'uninstall', 'kimi-cli']],
    ]);
    const probed = vi.mocked(spawnCommandSync).mock.calls.map(([cmd]) => cmd);
    expect(probed).not.toContain('curl');
    expect(probed).not.toContain('bash');
  });

  it('win32: without uv the environment check fails and manual steps use pip', async () => {
    onlyAvailable('curl', 'bash');
    const installer = createKimiInstaller({ platform: 'win32' });

    expect(await installer.checkEnvironment()).toEqual({ ok: false, missing: ['uv'] });
    expect(installer.manualInstructions.commands[0]).toBe('pip install kimi-cli');
    expect(installer.manualInstructions.commands.join('\n')).not.toMatch(/curl|bash/);
    expect(installer.manualInstructions.commands.join('\n')).toContain('docs.astral.sh/uv');
  });
});
