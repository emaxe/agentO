import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const codexInstaller = createNpmInstaller({
  agentId: 'codex' as AgentId,
  command: 'codex',
  packageName: '@openai/codex',
  docsUrl: 'https://github.com/openai/codex',
});
