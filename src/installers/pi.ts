import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const piInstaller = createNpmInstaller({
  agentId: 'pi' as AgentId,
  command: 'pi',
  packageName: '@earendil-works/pi-coding-agent',
  docsUrl: 'https://pi.dev/docs/getting-started/installation',
});
