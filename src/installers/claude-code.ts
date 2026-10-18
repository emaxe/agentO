import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createClaudeCodeInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'claude-code' as AgentId,
      command: 'claude',
      packageName: '@anthropic-ai/claude-code',
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    },
    options,
  );
}

export const claudeCodeInstaller = createClaudeCodeInstaller();
