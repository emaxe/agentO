import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import { commandAvailable, probeVersion, runCommand, type InstallerOptions } from './shared.js';

/**
 * Official Hermes installers. `--skip-setup` keeps the installer non-interactive:
 * AgentO configures the model/provider itself, so the bundled setup wizard would
 * only compete with the generated config.
 */
const POSIX_INSTALL =
  'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup';
const WINDOWS_INSTALL =
  '& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -SkipSetup';

export interface HermesInstallerOptions extends InstallerOptions {
  /** Which registry entry this installer belongs to (CLI or Desktop). */
  agentId?: AgentId;
}

/**
 * Installer for Hermes Agent and Hermes Desktop.
 *
 * Hermes is a Python/git distribution, not an npm package:
 * - POSIX: the official shell script (needs `bash`, `curl`, `git`).
 * - win32: the official PowerShell one-liner.
 * Both agents share one binary, so install/update/uninstall are identical.
 */
export function createHermesInstaller(options: HermesInstallerOptions = {}): AgentInstaller {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  const agentId = options.agentId ?? ('hermes' as AgentId);

  const runPowerShell = (): Promise<InstallResult> =>
    runCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      WINDOWS_INSTALL,
    ]);

  return {
    agentId,

    manualInstructions: {
      commands: [POSIX_INSTALL],
      docsUrl: 'https://github.com/NousResearch/hermes-agent',
      windows: { commands: [WINDOWS_INSTALL] },
    },

    /** `hermes --version` prints `Hermes Agent v0.20.0 (2026.8.3)`. */
    async checkInstalled(): Promise<InstallCheckResult> {
      return probeVersion('hermes');
    },

    /** POSIX needs bash/curl/git for the install script; Windows only PowerShell. */
    async checkEnvironment(): Promise<EnvCheckResult> {
      if (windows) return { ok: true, missing: [] };

      const missing: string[] = [];
      for (const dependency of ['bash', 'curl', 'git']) {
        if (!(await commandAvailable(dependency))) missing.push(dependency);
      }
      return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
    },

    async install(): Promise<InstallResult> {
      return windows ? runPowerShell() : runCommand('bash', ['-lc', POSIX_INSTALL]);
    },

    /** Hermes ships its own updater; it works the same on both platforms. */
    async update(): Promise<InstallResult> {
      return runCommand('hermes', ['update']);
    },

    async uninstall(): Promise<InstallResult> {
      return runCommand('hermes', ['uninstall']);
    },
  };
}

export const hermesInstaller = createHermesInstaller({ agentId: 'hermes' as AgentId });

export const hermesDesktopInstaller = createHermesInstaller({
  agentId: 'hermes-desktop' as AgentId,
});
