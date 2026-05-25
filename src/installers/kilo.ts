import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const kiloInstaller = createNpmInstaller({
  agentId: 'kilo' as AgentId,
  command: 'kilo',
  packageName: '@kilocode/cli',
  docsUrl: 'https://kilo.ai/docs/getting-started',
});
