import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import { commandAvailable, probeVersion, runCommand, type InstallerOptions } from './shared.js';

const INSTALL_SCRIPT = 'curl -LsSf https://code.kimi.com/install.sh | bash';
const WINDOWS_MANUAL = [
  'pip install kimi-cli',
  '# or, with uv: uv tool install --python 3.13 kimi-cli',
  '# Install uv: https://docs.astral.sh/uv/getting-started/installation/',
];

/**
 * Installer for Kimi Code CLI.
 *
 * Kimi Code is distributed as a Python package (kimi-cli) on PyPI.
 *
 * - POSIX: the official shell script, which bootstraps the `uv` package manager and runs
 *   `uv tool install --python 3.13 kimi-cli`. Manual fallback: `curl -LsSf https://code.kimi.com/install.sh | bash`.
 * - win32: `uv tool install` directly when `uv` is present, otherwise manual only.
 *   The shell script is never run on Windows.
 */
export function createKimiInstaller(options: InstallerOptions = {}): AgentInstaller {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';

  const runUv = (args: string[]): Promise<InstallResult> => runCommand('uv', args);
  const runScript = (): Promise<InstallResult> => runCommand('bash', ['-c', INSTALL_SCRIPT]);

  return {
    agentId: 'kimi' as AgentId,

    manualInstructions: {
      commands: windows ? WINDOWS_MANUAL : [INSTALL_SCRIPT],
      docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html',
      windows: { commands: WINDOWS_MANUAL },
    },

    /** Checks whether `kimi --version` succeeds and parses the version string. */
    async checkInstalled(): Promise<InstallCheckResult> {
      return probeVersion('kimi');
    },

    /** POSIX needs `curl` or `wget` for the install script; Windows needs `uv`. */
    async checkEnvironment(): Promise<EnvCheckResult> {
      if (windows) {
        return (await commandAvailable('uv'))
          ? { ok: true, missing: [] }
          : { ok: false, missing: ['uv'] };
      }
      const curlOk = await commandAvailable('curl');
      const wgetOk = await commandAvailable('wget');
      if (!curlOk && !wgetOk) {
        return { ok: false, missing: ['curl', 'wget'] };
      }
      return { ok: true, missing: [] };
    },

    async install(): Promise<InstallResult> {
      return windows ? runUv(['tool', 'install', '--python', '3.13', 'kimi-cli']) : runScript();
    },

    /** POSIX re-runs the install script; Windows upgrades through uv. */
    async update(): Promise<InstallResult> {
      return windows ? runUv(['tool', 'upgrade', 'kimi-cli']) : runScript();
    },

    async uninstall(): Promise<InstallResult> {
      return runUv(['tool', 'uninstall', 'kimi-cli']);
    },
  };
}

export const kimiInstaller = createKimiInstaller();
