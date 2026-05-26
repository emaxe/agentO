import { spawnSync, spawn } from 'node:child_process';
import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';

/** Installer for the GitHub Copilot CLI agent (brew cask). */
class CopilotInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'copilot';

  readonly manualInstructions = {
    commands: ['brew install --cask copilot-cli'],
    docsUrl: 'https://docs.github.com/copilot/how-tos/copilot-cli',
  };

  /** Checks whether `copilot --version` succeeds and parses the version string. */
  async checkInstalled(): Promise<InstallCheckResult> {
    const result = spawnSync('copilot', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { installed: false };
    }
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const match = output.match(/GitHub Copilot CLI (\d+\.\d+\.\d+[^\s]*)/);
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

  /** Runs `brew install --cask copilot-cli` and reports the result. */
  async install(): Promise<InstallResult> {
    return this._runBrew(['install', '--cask', 'copilot-cli']);
  }

  /** Runs `brew upgrade --cask copilot-cli` and reports the result. */
  async update(): Promise<InstallResult> {
    return this._runBrew(['upgrade', '--cask', 'copilot-cli']);
  }

  /** Runs `brew uninstall --cask copilot-cli` and reports the result. */
  async uninstall(): Promise<InstallResult> {
    return this._runBrew(['uninstall', '--cask', 'copilot-cli']);
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

export const copilotInstaller = new CopilotInstaller();
