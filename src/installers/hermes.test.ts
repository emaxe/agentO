import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnCommand, spawnCommandSync } from '../platform/spawn.js';
import { errnoError, fakeChild, syncResult } from '../test-utils/spawn-fakes.js';
import { createHermesInstaller, hermesInstaller, hermesDesktopInstaller } from './hermes.js';

vi.mock('../platform/spawn.js', () => ({
  spawnCommand: vi.fn(),
  spawnCommandSync: vi.fn(),
}));

vi.mock('../launcher/shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn().mockResolvedValue('/p'), invalidate: vi.fn() },
}));

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

const POSIX_INSTALL =
  'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup';
const WINDOWS_INSTALL =
  '& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -SkipSetup';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(spawnCommand).mockImplementation(() => fakeChild(0));
});

describe('Hermes installers', () => {
  it('exposes one installer per registry entry', () => {
    expect(hermesInstaller.agentId).toBe('hermes');
    expect(hermesDesktopInstaller.agentId).toBe('hermes-desktop');
    expect(hermesInstaller.manualInstructions.docsUrl).toBe(
      'https://github.com/NousResearch/hermes-agent',
    );
    expect(hermesInstaller.manualInstructions.windows?.commands).toEqual([WINDOWS_INSTALL]);
  });

  it('reads the version out of `Hermes Agent v0.20.0 (2026.8.3)`', async () => {
    vi.mocked(spawnCommandSync).mockReturnValue(
      syncResult({ stdout: 'Hermes Agent v0.20.0 (2026.8.3)\nInstall method: git\n' }),
    );

    await expect(createHermesInstaller({ platform: 'darwin' }).checkInstalled()).resolves.toEqual({
      installed: true,
      version: '0.20.0',
    });
  });

  it('reports a missing binary as not-found', async () => {
    vi.mocked(spawnCommandSync).mockReturnValue(
      syncResult({ status: null, error: errnoError('ENOENT') }),
    );

    await expect(createHermesInstaller({ platform: 'linux' }).checkInstalled()).resolves.toEqual({
      installed: false,
      reason: 'not-found',
    });
  });

  it('POSIX: requires bash, curl and git and runs the official script', async () => {
    onlyAvailable('bash', 'curl', 'git');
    const installer = createHermesInstaller({ platform: 'darwin' });

    await expect(installer.checkEnvironment()).resolves.toEqual({ ok: true, missing: [] });
    await installer.install();

    expect(spawned()).toEqual([['bash', ['-lc', POSIX_INSTALL]]]);
    expect(installer.manualInstructions.commands).toEqual([POSIX_INSTALL]);
  });

  it('POSIX: lists every missing dependency', async () => {
    onlyAvailable('bash');
    const installer = createHermesInstaller({ platform: 'linux' });

    await expect(installer.checkEnvironment()).resolves.toEqual({
      ok: false,
      missing: ['curl', 'git'],
    });
  });

  it('Windows: uses the PowerShell installer and needs no POSIX tooling', async () => {
    onlyAvailable();
    const installer = createHermesInstaller({ platform: 'win32' });

    await expect(installer.checkEnvironment()).resolves.toEqual({ ok: true, missing: [] });
    await installer.install();

    expect(spawned()).toEqual([
      ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_INSTALL]],
    ]);
  });

  it('updates and uninstalls through the Hermes CLI', async () => {
    const installer = createHermesInstaller({ platform: 'linux' });

    await installer.update?.();
    await installer.uninstall?.();

    expect(spawned()).toEqual([
      ['hermes', ['update']],
      ['hermes', ['uninstall']],
    ]);
  });

  it('surfaces installer stderr', async () => {
    vi.mocked(spawnCommand).mockImplementation(() => fakeChild(1, 'curl: (22) boom'));

    await expect(createHermesInstaller({ platform: 'linux' }).install()).resolves.toEqual({
      success: false,
      error: 'curl: (22) boom',
    });
  });
});
