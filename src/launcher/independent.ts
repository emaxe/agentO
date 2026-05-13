import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { prepareLaunchTransaction, type ExecRequest } from './transaction.js';

export type { ExecRequest } from './transaction.js';

export interface IndependentLaunchOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
}

/**
 * Prepares the agent configuration for an independent launch.
 *
 * Workflow:
 * 1. Backup the current agent config.
 * 2. Generate and write the new agent config from the selected profile.
 * 3. Resolve the full user PATH (via login shell) so the agent binary is discoverable.
 * 4. Return an {@link ExecRequest} with the resolved environment.
 *
 * In this mode the user is responsible for restoring the original config
 * (e.g. via `agento restore`).
 */
export async function launchIndependent(options: IndependentLaunchOptions): Promise<ExecRequest> {
  const { execReq } = await prepareLaunchTransaction(options);
  return execReq;
}
