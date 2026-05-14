import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const claudeCodeInstaller = createNpmInstaller({
  agentId: 'claude-code' as AgentId,
  command: 'claude',
  packageName: '@anthropic-ai/claude-code',
  docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
});
