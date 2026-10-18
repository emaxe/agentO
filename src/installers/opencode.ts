import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createOpenCodeInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'opencode' as AgentId,
      command: 'opencode',
      packageName: 'opencode-ai',
      docsUrl: 'https://opencode.ai/docs',
    },
    options,
  );
}

export const openCodeInstaller = createOpenCodeInstaller();
