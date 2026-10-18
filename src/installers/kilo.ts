import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createKiloInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'kilo' as AgentId,
      command: 'kilo',
      packageName: '@kilocode/cli',
      docsUrl: 'https://kilo.ai/docs/getting-started',
    },
    options,
  );
}

export const kiloInstaller = createKiloInstaller();
