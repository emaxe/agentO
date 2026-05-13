/** Thin compatibility wrapper around the unified agent registry. */
import type { AgentId } from '../config/schema.js';
import type { AgentInstaller } from './base.js';
import { getAgentInstaller } from '../agents/registry.js';

/** Returns the installer for a given agent id, or `undefined` if unregistered. */
export function getInstaller(agentId: AgentId): AgentInstaller | undefined {
  return getAgentInstaller(agentId, { dev: true });
}
