import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import {
  commandAvailable,
  defaultVersionRegex,
  probeVersion,
  runCommand,
  type InstallerOptions,
} from './shared.js';

export interface NpmInstallerConfig {
  readonly agentId: AgentId;
  readonly command: string;
  readonly packageName: string;
  readonly docsUrl: string;
  readonly versionRegex?: RegExp;
}

export interface RunNpmOptions {
  platform?: NodeJS.Platform;
}

function cleanPackageName(packageName: string): string {
  return packageName.replace(/@[^@/]+$/, '');
}

/** What to try when npm cannot write to its global prefix. */
export function permissionHint(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? 'Permission denied. Point npm at a user-writable prefix: npm config set prefix %APPDATA%\\npm'
    : 'Permission denied. Re-run with sudo, or point npm at a user-writable prefix: npm config set prefix ~/.npm-global';
}

/** Runs `npm <args>`; a successful run invalidates the cached PATH. */
export function runNpm(args: string[], opts: RunNpmOptions = {}): Promise<InstallResult> {
  return runCommand('npm', args, {
    permissionHint: permissionHint(opts.platform ?? process.platform),
  });
}

export function createNpmInstaller(
  config: NpmInstallerConfig,
  options: InstallerOptions = {},
): AgentInstaller {
  const platform = options.platform ?? process.platform;
  const versionRegex = config.versionRegex ?? defaultVersionRegex;

  return {
    agentId: config.agentId,

    manualInstructions: {
      commands: [`npm install -g ${config.packageName}`],
      docsUrl: config.docsUrl,
    },

    async checkInstalled(): Promise<InstallCheckResult> {
      return probeVersion(config.command, versionRegex);
    },

    async checkEnvironment(): Promise<EnvCheckResult> {
      if (!(await commandAvailable('npm'))) {
        return { ok: false, missing: ['npm'] };
      }
      return { ok: true, missing: [] };
    },

    install: () => runNpm(['install', '-g', config.packageName], { platform }),
    update: () => runNpm(['update', '-g', cleanPackageName(config.packageName)], { platform }),
    uninstall: () => runNpm(['uninstall', '-g', config.packageName], { platform }),
  };
}
