import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';
import { spawnCommand, spawnCommandSync } from '../platform/spawn.js';

export interface NpmInstallerConfig {
  readonly agentId: AgentId;
  readonly command: string;
  readonly packageName: string;
  readonly docsUrl: string;
  readonly versionRegex?: RegExp;
}

const defaultVersionRegex = /(\d+\.\d+\.\d+[^\s]*)/;

function cleanPackageName(packageName: string): string {
  return packageName.replace(/@[^@/]+$/, '');
}

export function createNpmInstaller(config: NpmInstallerConfig): AgentInstaller {
  const versionRegex = config.versionRegex ?? defaultVersionRegex;

  return {
    agentId: config.agentId,

    manualInstructions: {
      commands: [`npm install -g ${config.packageName}`],
      docsUrl: config.docsUrl,
    },

    async checkInstalled(): Promise<InstallCheckResult> {
      const result = spawnCommandSync(config.command, ['--version'], { encoding: 'utf8' });
      if (result.status !== 0) {
        return { installed: false };
      }
      const output = (result.stdout ?? '') + (result.stderr ?? '');
      const match = output.match(versionRegex);
      const version = match?.[1];
      return { installed: true, ...(version !== undefined ? { version } : {}) };
    },

    async checkEnvironment(): Promise<EnvCheckResult> {
      const result = spawnCommandSync('npm', ['--version'], { encoding: 'utf8' });
      if (result.status !== 0) {
        return { ok: false, missing: ['npm'] };
      }
      return { ok: true, missing: [] };
    },

    async install(): Promise<InstallResult> {
      return new Promise<InstallResult>((resolve) => {
        const stderrChunks: Buffer[] = [];

        const child = spawnCommand('npm', ['install', '-g', config.packageName], {
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('exit', (code) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            const error = Buffer.concat(stderrChunks).toString('utf8').trim();
            resolve({ success: false, error: error || `npm exited with code ${code}` });
          }
        });

        child.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    },

    async update(): Promise<InstallResult> {
      return new Promise<InstallResult>((resolve) => {
        const stderrChunks: Buffer[] = [];

        const child = spawnCommand('npm', ['update', '-g', cleanPackageName(config.packageName)], {
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('exit', (code) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            const error = Buffer.concat(stderrChunks).toString('utf8').trim();
            resolve({ success: false, error: error || `npm exited with code ${code}` });
          }
        });

        child.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    },

    async uninstall(): Promise<InstallResult> {
      return new Promise<InstallResult>((resolve) => {
        const stderrChunks: Buffer[] = [];

        const child = spawnCommand('npm', ['uninstall', '-g', config.packageName], {
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('exit', (code) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            const error = Buffer.concat(stderrChunks).toString('utf8').trim();
            resolve({ success: false, error: error || `npm exited with code ${code}` });
          }
        });

        child.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      });
    },
  };
}
