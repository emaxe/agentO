import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createPiInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'pi' as AgentId,
      command: 'pi',
      packageName: '@earendil-works/pi-coding-agent',
      docsUrl: 'https://pi.dev/docs/getting-started/installation',
    },
    options,
  );
}

export const piInstaller = createPiInstaller();
