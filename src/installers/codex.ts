import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createCodexInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'codex' as AgentId,
      command: 'codex',
      packageName: '@openai/codex',
      docsUrl: 'https://github.com/openai/codex',
    },
    options,
  );
}

export const codexInstaller = createCodexInstaller();
