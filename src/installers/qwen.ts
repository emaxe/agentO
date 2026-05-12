import { spawnSync, spawn } from 'node:child_process';
import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';

/** Installer for the Qwen CLI agent. */
class QwenInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'qwen';

  readonly manualInstructions = {
    commands: ['npm install -g @qwen-code/qwen-code@latest'],
    docsUrl: 'https://github.com/QwenLM/qwen-code',
  };

  /** Checks whether `qwen --version` succeeds. */
  async checkInstalled(): Promise<InstallCheckResult> {
    const result = spawnSync('qwen', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { installed: false };
    }
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const match = output.match(/(\d+\.\d+\.\d+[^\s]*)/);
    const version = match?.[1];
    return { installed: true, ...(version !== undefined ? { version } : {}) };
  }

  /** Verifies that `npm` is available on the system. */
  async checkEnvironment(): Promise<EnvCheckResult> {
    const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { ok: false, missing: ['npm'] };
    }
    return { ok: true, missing: [] };
  }

  /** Runs `npm install -g @qwen-code/qwen-code@latest` and reports the result. */
  async install(): Promise<InstallResult> {
    return new Promise<InstallResult>((resolve) => {
      const stderrChunks: Buffer[] = [];

      const child = spawn('npm', ['install', '-g', '@qwen-code/qwen-code@latest'], {
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
          resolve({ success: false, error: error || `npm exited with code ${code}` });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }
}

export const qwenInstaller = new QwenInstaller();
