import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnCommand, spawnCommandSync } from '../platform/spawn.js';
import { shellPathResolver } from '../launcher/shell-path-resolver.js';
import { createNpmInstaller, runNpm } from './npm.js';
import { errnoError, failingChild, fakeChild, syncResult } from '../test-utils/spawn-fakes.js';

vi.mock('../platform/spawn.js', () => ({
  spawnCommand: vi.fn(),
  spawnCommandSync: vi.fn(),
}));

vi.mock('../launcher/shell-path-resolver.js', () => ({
  shellPathResolver: { resolve: vi.fn(), invalidate: vi.fn() },
}));

const config = {
  agentId: 'claude-code',
  command: 'claude',
  packageName: '@anthropic-ai/claude-code',
  docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
} as const;

const RESOLVED_PATH = '/resolved/bin';

describe('createNpmInstaller', () => {
  const installer = createNpmInstaller(config, { platform: 'linux' });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(shellPathResolver.resolve).mockResolvedValue(RESOLVED_PATH);
  });

  describe('install', () => {
    it('calls npm install -g with the resolved PATH and invalidates it on success', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(0));

      const result = await installer.install();

      expect(result.success).toBe(true);
      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['install', '-g', '@anthropic-ai/claude-code'],
        expect.objectContaining({
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
          env: expect.objectContaining({ PATH: RESOLVED_PATH }),
        }),
      );
      expect(shellPathResolver.invalidate).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate the PATH when npm fails', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(1, 'boom'));

      const result = await installer.install();

      expect(result).toEqual({ success: false, error: 'boom' });
      expect(shellPathResolver.invalidate).not.toHaveBeenCalled();
    });

    it('reports a spawn error', async () => {
      vi.mocked(spawnCommand).mockReturnValue(failingChild(new Error('spawn npm ENOENT')));

      expect(await installer.install()).toEqual({ success: false, error: 'spawn npm ENOENT' });
    });

    it('falls back to a generic message when npm prints nothing', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(2));

      expect((await installer.install()).error).toBe('npm exited with code 2');
    });
  });

  describe('update', () => {
    it('calls npm update -g and resolves success on exit 0', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(0));

      const result = await installer.update();
      expect(result.success).toBe(true);
      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['update', '-g', '@anthropic-ai/claude-code'],
        expect.objectContaining({ stdio: ['ignore', 'inherit', 'pipe'], shell: false }),
      );
      expect(shellPathResolver.invalidate).toHaveBeenCalled();
    });

    it('strips the version tag from the package name', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(0));
      const tagged = createNpmInstaller({ ...config, packageName: '@qwen-code/qwen-code@latest' });

      await tagged.update?.();

      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['update', '-g', '@qwen-code/qwen-code'],
        expect.anything(),
      );
    });

    it('resolves failure on non-zero exit', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(1, 'npm err'));

      const result = await installer.update();
      expect(result.success).toBe(false);
      expect(result.error).toContain('npm err');
    });
  });

  describe('uninstall', () => {
    it('calls npm uninstall -g and resolves success on exit 0', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(0));

      const result = await installer.uninstall();
      expect(result.success).toBe(true);
      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['uninstall', '-g', '@anthropic-ai/claude-code'],
        expect.objectContaining({ stdio: ['ignore', 'inherit', 'pipe'], shell: false }),
      );
      expect(shellPathResolver.invalidate).toHaveBeenCalled();
    });

    it('resolves failure on non-zero exit', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(1, 'npm err'));

      const result = await installer.uninstall();
      expect(result.success).toBe(false);
      expect(result.error).toContain('npm err');
    });
  });

  describe('permission errors', () => {
    const stderr = 'npm error code EACCES\nnpm error syscall mkdir';

    it('suggests sudo / a user prefix on POSIX', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(243, stderr));

      const result = await runNpm(['install', '-g', 'x'], { platform: 'linux' });

      expect(result.error).toContain('EACCES');
      expect(result.error).toContain('sudo');
    });

    it('suggests the %APPDATA%\\npm prefix on Windows', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(243, 'npm error code EPERM'));

      const result = await runNpm(['install', '-g', 'x'], { platform: 'win32' });

      expect(result.error).toContain('npm config set prefix %APPDATA%\\npm');
    });

    it('adds no hint for unrelated failures', async () => {
      vi.mocked(spawnCommand).mockReturnValue(fakeChild(1, 'npm error 404 Not Found'));

      const result = await runNpm(['install', '-g', 'x'], { platform: 'win32' });

      expect(result.error).toBe('npm error 404 Not Found');
    });
  });

  describe('checkInstalled', () => {
    it('probes --version with a timeout and the resolved PATH', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(
        syncResult({ stdout: 'claude 1.2.3 (Claude)\n' }),
      );

      const result = await installer.checkInstalled();

      expect(result).toEqual({ installed: true, version: '1.2.3' });
      expect(spawnCommandSync).toHaveBeenCalledWith(
        'claude',
        ['--version'],
        expect.objectContaining({
          encoding: 'utf8',
          timeout: 10_000,
          env: expect.objectContaining({ PATH: RESOLVED_PATH }),
        }),
      );
    });

    it('reports installed without a version when the output has none', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(syncResult({ stdout: 'ok' }));

      expect(await installer.checkInstalled()).toEqual({ installed: true });
    });

    it('reports reason not-found on ENOENT', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(
        syncResult({ status: null, error: errnoError('ENOENT') }),
      );

      expect(await installer.checkInstalled()).toEqual({ installed: false, reason: 'not-found' });
    });

    it('reports reason timeout on ETIMEDOUT', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(
        syncResult({ status: null, signal: 'SIGTERM', error: errnoError('ETIMEDOUT') }),
      );

      expect(await installer.checkInstalled()).toEqual({ installed: false, reason: 'timeout' });
    });

    it('reports reason timeout when only SIGTERM is visible', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(syncResult({ status: null, signal: 'SIGTERM' }));

      expect(await installer.checkInstalled()).toEqual({ installed: false, reason: 'timeout' });
    });

    it('reports reason failed on a non-zero exit', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(syncResult({ status: 1 }));

      expect(await installer.checkInstalled()).toEqual({ installed: false, reason: 'failed' });
    });

    it('reports reason failed on other spawn errors', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(
        syncResult({ status: null, error: errnoError('EACCES') }),
      );

      expect(await installer.checkInstalled()).toEqual({ installed: false, reason: 'failed' });
    });
  });

  describe('checkEnvironment', () => {
    it('is ok when npm --version succeeds, probed with the resolved PATH', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(syncResult({ stdout: '10.0.0' }));

      expect(await installer.checkEnvironment()).toEqual({ ok: true, missing: [] });
      expect(spawnCommandSync).toHaveBeenCalledWith(
        'npm',
        ['--version'],
        expect.objectContaining({ env: expect.objectContaining({ PATH: RESOLVED_PATH }) }),
      );
    });

    it('reports npm missing', async () => {
      vi.mocked(spawnCommandSync).mockReturnValue(
        syncResult({ status: null, error: errnoError('ENOENT') }),
      );

      expect(await installer.checkEnvironment()).toEqual({ ok: false, missing: ['npm'] });
    });
  });

  it('exposes the npm command as manual instructions', () => {
    expect(installer.manualInstructions).toEqual({
      commands: ['npm install -g @anthropic-ai/claude-code'],
      docsUrl: config.docsUrl,
    });
  });
});
