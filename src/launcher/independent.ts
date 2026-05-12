import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { writeBackup } from '../config/store.js';
import { shellPathResolver } from './shell-path-resolver.js';

/**
 * Request object for executing an agent after config has been patched.
 * Used by the TUI and CLI to hand off control to the external agent binary.
 */
export interface ExecRequest {
  command: string;
  args: string[];
  env: Record<string, string>;
  relaunch?: boolean;
  cleanup?: () => Promise<void>;
}

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
  const { adapter, profile, providers, scope, command, args = [], cwd } = options;

  // 1. Backup текущего конфига агента
  const currentConfig = await adapter.readConfig(scope, cwd);
  await writeBackup(adapter.id, scope, currentConfig ?? {});

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Резолвим PATH чтобы найти исполняемый файл агента
  const resolvedPath = await shellPathResolver.resolve();

  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};

  return {
    command,
    args,
    env: { ...cleanEnv, PATH: resolvedPath, ...adapterEnv },
  };
}
