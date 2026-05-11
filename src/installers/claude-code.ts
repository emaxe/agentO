import { spawnSync, spawn } from 'node:child_process';
import type { AgentInstaller, InstallCheckResult, EnvCheckResult, InstallResult } from './base.js';
import type { AgentId } from '../config/schema.js';

class ClaudeCodeInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'claude-code';

  readonly manualInstructions = {
    commands: ['npm install -g @anthropic-ai/claude-code'],
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  };

  async checkInstalled(): Promise<InstallCheckResult> {
    const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { installed: false };
    }
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    const match = output.match(/(\d+\.\d+\.\d+[^\s]*)/);
    const version = match?.[1];
    return { installed: true, ...(version !== undefined ? { version } : {}) };
  }

  async checkEnvironment(): Promise<EnvCheckResult> {
    const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return { ok: false, missing: ['npm'] };
    }
    return { ok: true, missing: [] };
  }

  async install(): Promise<InstallResult> {
    return new Promise<InstallResult>((resolve) => {
      const stderrChunks: Buffer[] = [];

      const child = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
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

export const claudeCodeInstaller = new ClaudeCodeInstaller();
