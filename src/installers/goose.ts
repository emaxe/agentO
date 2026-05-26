import { spawnSync, spawn } from 'node:child_process';
import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';

/** Installer for the Goose CLI agent (brew cask). */
class GooseInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'goose';

  readonly manualInstructions = {
    commands: ['brew install block-goose-cli'],
    docsUrl: 'https://goose-docs.ai/docs/getting-started/installation',
  };

  /** Checks whether `goose --version` succeeds and parses the version string. */
  async checkInstalled(): Promise<InstallCheckResult> {
    const result = spawnSync('goose', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { installed: false };
    }
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const match = output.match(/(\d+\.\d+\.\d+[^\s]*)/);
    const version = match?.[1];
    return { installed: true, ...(version !== undefined ? { version } : {}) };
  }

  /** Verifies that `brew` is available on the system. */
  async checkEnvironment(): Promise<EnvCheckResult> {
    const result = spawnSync('brew', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { ok: false, missing: ['brew'] };
    }
    return { ok: true, missing: [] };
  }

  /** Runs `brew install block-goose-cli` and reports the result. */
  async install(): Promise<InstallResult> {
    return this._runBrew(['install', 'block-goose-cli']);
  }

  /** Runs `brew upgrade block-goose-cli` and reports the result. */
  async update(): Promise<InstallResult> {
    return this._runBrew(['upgrade', 'block-goose-cli']);
  }

  /** Runs `brew uninstall block-goose-cli` and reports the result. */
  async uninstall(): Promise<InstallResult> {
    return this._runBrew(['uninstall', 'block-goose-cli']);
  }

  private _runBrew(args: string[]): Promise<InstallResult> {
    return new Promise<InstallResult>((resolve) => {
      const stderrChunks: Buffer[] = [];

      const child = spawn('brew', args, {
        stdio: ['ignore', 'inherit', 'pipe'],
        shell: false,
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          const error = Buffer.concat(stderrChunks).toString('utf8').trim();
          resolve({ success: false, error: error || `brew exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}

export const gooseInstaller = new GooseInstaller();
