import { spawnSync, spawn } from 'node:child_process';
import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';

/**
 * Installer for Kimi Code CLI.
 *
 * Kimi Code is distributed as a Python package (kimi-cli) on PyPI
 * and is installed via an official shell script that bootstraps the
 * `uv` Python package manager and then runs `uv tool install --python 3.13 kimi-cli`.
 *
 * Manual fallback command: `curl -LsSf https://code.kimi.com/install.sh | bash`
 */
class KimiInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'kimi';

  readonly manualInstructions = {
    commands: ['curl -LsSf https://code.kimi.com/install.sh | bash'],
    docsUrl: 'https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html',
  };

  /** Checks whether `kimi --version` succeeds and parses the version string. */
  async checkInstalled(): Promise<InstallCheckResult> {
    const result = spawnSync('kimi', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { installed: false };
    }
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const match = output.match(/(\d+\.\d+\.\d+[^\s]*)/);
    const version = match?.[1];
    return { installed: true, ...(version !== undefined ? { version } : {}) };
  }

  /** Verifies that either `curl` or `wget` is available for the install script. */
  async checkEnvironment(): Promise<EnvCheckResult> {
    const curlOk = spawnSync('curl', ['--version'], { encoding: 'utf8' }).status === 0;
    const wgetOk = spawnSync('wget', ['--version'], { encoding: 'utf8' }).status === 0;

    if (!curlOk && !wgetOk) {
      return { ok: false, missing: ['curl', 'wget'] };
    }
    return { ok: true, missing: [] };
  }

  /** Runs the official Kimi install script via bash. */
  async install(): Promise<InstallResult> {
    return this._runScript('curl -LsSf https://code.kimi.com/install.sh | bash');
  }

  /** Re-runs the install script to update Kimi. */
  async update(): Promise<InstallResult> {
    return this._runScript('curl -LsSf https://code.kimi.com/install.sh | bash');
  }

  /** Uninstalls Kimi via uv tool uninstall. */
  async uninstall(): Promise<InstallResult> {
    return new Promise<InstallResult>((resolve) => {
      const stderrChunks: Buffer[] = [];

      const child = spawn('uv', ['tool', 'uninstall', 'kimi-cli'], {
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
          resolve({ success: false, error: error || `uv tool uninstall exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  private _runScript(script: string): Promise<InstallResult> {
    return new Promise<InstallResult>((resolve) => {
      const stderrChunks: Buffer[] = [];

      const child = spawn('bash', ['-c', script], {
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
          resolve({ success: false, error: error || `Script exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}

export const kimiInstaller = new KimiInstaller();
