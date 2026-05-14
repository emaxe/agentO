import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const openCodeInstaller = createNpmInstaller({
  agentId: 'opencode' as AgentId,
  command: 'opencode',
  packageName: 'opencode',
  docsUrl: 'https://opencode.ai/docs',
});
