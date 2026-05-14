import { createNpmInstaller } from './npm.js';
import type { AgentId } from '../config/schema.js';

export const qwenInstaller = createNpmInstaller({
  agentId: 'qwen' as AgentId,
  command: 'qwen',
  packageName: '@qwen-code/qwen-code@latest',
  docsUrl: 'https://github.com/QwenLM/qwen-code',
});
