import type { AgentId } from '../config/schema.js';
import type { AgentInstaller } from './base.js';
import { claudeCodeInstaller } from './claude-code.js';
import { openCodeInstaller } from './opencode.js';
import { qwenInstaller } from './qwen.js';
import { codexInstaller } from './codex.js';

const registry = new Map<AgentId, AgentInstaller>([
  ['claude-code', claudeCodeInstaller],
  ['opencode', openCodeInstaller],
  ['qwen', qwenInstaller],
  ['codex', codexInstaller],
]);

export function getInstaller(agentId: AgentId): AgentInstaller | undefined {
  return registry.get(agentId);
}
