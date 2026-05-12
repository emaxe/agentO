/**
 * Registry of agent installers used by the TUI install wizard.
 *
 * Each supported agent maps to an {@link AgentInstaller} that can check
 * whether the agent is installed, verify prerequisites, and perform auto-install.
 */
import type { AgentId } from '../config/schema.js';
import type { AgentInstaller } from './base.js';
import { claudeCodeInstaller } from './claude-code.js';
import { openCodeInstaller } from './opencode.js';
import { qwenInstaller } from './qwen.js';
import { codexInstaller } from './codex.js';

/** Internal map of agent ids to their installers. */
const registry = new Map<AgentId, AgentInstaller>([
  ['claude-code', claudeCodeInstaller],
  ['opencode', openCodeInstaller],
  ['qwen', qwenInstaller],
  ['codex', codexInstaller],
]);

/** Returns the installer for a given agent id, or `undefined` if unregistered. */
export function getInstaller(agentId: AgentId): AgentInstaller | undefined {
  return registry.get(agentId);
}
