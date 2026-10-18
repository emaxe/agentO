import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import { commandAvailable, probeVersion, runCommand, type InstallerOptions } from './shared.js';

const FORMULA = 'block-goose-cli';
const WINDOWS_MANUAL = [
  'winget search goose',
  '# Releases: https://github.com/block/goose/releases/latest',
];
const WINDOWS_UNSUPPORTED =
  'Automatic installation of Goose is not supported on Windows. Use the manual instructions.';

/**
 * Installer for the Goose CLI agent (brew on macOS/Linux).
 *
 * On Windows there is no auto-install: no winget package id has been verified, so
 * only manual instructions are offered.
 */
export function createGooseInstaller(options: InstallerOptions = {}): AgentInstaller {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';

  return {
    agentId: 'goose' as AgentId,

    manualInstructions: {
      commands: windows ? WINDOWS_MANUAL : [`brew install ${FORMULA}`],
      docsUrl: 'https://goose-docs.ai/docs/getting-started/installation',
      windows: { commands: WINDOWS_MANUAL },
    },

    /** Checks whether `goose --version` succeeds and parses the version string. */
    async checkInstalled(): Promise<InstallCheckResult> {
      return probeVersion('goose');
    },

    /** Verifies that `brew` is available (Windows has no supported auto-install). */
    async checkEnvironment(): Promise<EnvCheckResult> {
      if (windows) return { ok: false, missing: ['Windows auto-install support'] };
      if (!(await commandAvailable('brew'))) return { ok: false, missing: ['brew'] };
      return { ok: true, missing: [] };
    },

    async install(): Promise<InstallResult> {
      if (windows) return { success: false, error: WINDOWS_UNSUPPORTED };
      return runCommand('brew', ['install', FORMULA]);
    },

    async update(): Promise<InstallResult> {
      if (windows) return { success: false, error: WINDOWS_UNSUPPORTED };
      return runCommand('brew', ['upgrade', FORMULA]);
    },

    async uninstall(): Promise<InstallResult> {
      if (windows) return { success: false, error: WINDOWS_UNSUPPORTED };
      return runCommand('brew', ['uninstall', FORMULA]);
    },
  };
}

export const gooseInstaller = createGooseInstaller();
