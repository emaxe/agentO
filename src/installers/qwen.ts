import { createNpmInstaller } from './npm.js';
import type { InstallerOptions } from './shared.js';
import type { AgentId } from '../config/schema.js';

export function createQwenInstaller(options: InstallerOptions = {}) {
  return createNpmInstaller(
    {
      agentId: 'qwen' as AgentId,
      command: 'qwen',
      packageName: '@qwen-code/qwen-code@latest',
      docsUrl: 'https://github.com/QwenLM/qwen-code',
    },
    options,
  );
}

export const qwenInstaller = createQwenInstaller();
