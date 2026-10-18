import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import { permissionHint } from './npm.js';
import { commandAvailable, probeVersion, runCommand, type InstallerOptions } from './shared.js';

const WINGET_ID = 'GitHub.Copilot';
const NPM_PACKAGE = '@github/copilot';
const WINGET_FLAGS = ['--accept-source-agreements', '--accept-package-agreements'];

type Channel = 'brew' | 'winget' | 'npm';

/**
 * Installer for the GitHub Copilot CLI agent.
 *
 * - darwin: brew cask.
 * - win32: winget (`GitHub.Copilot`), then the npm package when winget is missing.
 * - other: the npm package.
 *
 * The channel is chosen from what is available at call time, so install, update and
 * uninstall all use the same one as long as the system does not change in between.
 */
export function createCopilotInstaller(options: InstallerOptions = {}): AgentInstaller {
  const platform = options.platform ?? process.platform;

  const manualCommands: Record<'darwin' | 'win32' | 'other', string[]> = {
    darwin: ['brew install --cask copilot-cli'],
    win32: [`winget install --id ${WINGET_ID} -e`, `npm install -g ${NPM_PACKAGE}`],
    other: [`npm install -g ${NPM_PACKAGE}`],
  };

  async function pickChannel(): Promise<Channel | null> {
    if (platform === 'darwin') return (await commandAvailable('brew')) ? 'brew' : null;
    if (platform === 'win32' && (await commandAvailable('winget'))) return 'winget';
    return (await commandAvailable('npm')) ? 'npm' : null;
  }

  async function run(action: 'install' | 'update' | 'uninstall'): Promise<InstallResult> {
    const channel = await pickChannel();
    switch (channel) {
      case 'brew': {
        const verb = action === 'update' ? 'upgrade' : action;
        return runCommand('brew', [verb, '--cask', 'copilot-cli']);
      }
      case 'winget': {
        const verb = action === 'update' ? 'upgrade' : action;
        const flags = action === 'uninstall' ? [] : WINGET_FLAGS;
        return runCommand('winget', [verb, '--id', WINGET_ID, '-e', ...flags]);
      }
      case 'npm': {
        const args =
          action === 'install'
            ? ['install', '-g', NPM_PACKAGE]
            : action === 'update'
              ? ['update', '-g', NPM_PACKAGE]
              : ['uninstall', '-g', NPM_PACKAGE];
        return runCommand('npm', args, { permissionHint: permissionHint(platform) });
      }
      default:
        return { success: false, error: 'No supported package manager found' };
    }
  }

  const key = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'other';

  return {
    agentId: 'copilot' as AgentId,

    manualInstructions: {
      commands: manualCommands[key],
      docsUrl: 'https://docs.github.com/copilot/how-tos/copilot-cli',
      windows: { commands: manualCommands.win32 },
    },

    /** Checks whether `copilot --version` succeeds and parses the version string. */
    async checkInstalled(): Promise<InstallCheckResult> {
      return probeVersion('copilot', /GitHub Copilot CLI (\d+\.\d+\.\d+[^\s]*)/);
    },

    /** Verifies that a package manager for this platform is available. */
    async checkEnvironment(): Promise<EnvCheckResult> {
      if ((await pickChannel()) !== null) return { ok: true, missing: [] };
      if (platform === 'darwin') return { ok: false, missing: ['brew'] };
      if (platform === 'win32') return { ok: false, missing: ['winget', 'npm'] };
      return { ok: false, missing: ['npm'] };
    },

    install: () => run('install'),
    update: () => run('update'),
    uninstall: () => run('uninstall'),
  };
}

export const copilotInstaller = createCopilotInstaller();
