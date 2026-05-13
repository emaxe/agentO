import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import { restoreBackupManifest } from '../config/backup-restore.js';
import type { Profile, Provider } from '../config/schema.js';
import { deleteBackup, inferBackupFileFormat, readBackup, writeBackup } from '../config/store.js';
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
  agentId?: string;
  profileId?: string;
}

export interface LaunchTransactionOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
}

export interface LaunchTransactionResult {
  execReq: ExecRequest;
  cleanup: () => Promise<void>;
}

function cleanProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

async function buildExecRequest(options: LaunchTransactionOptions & { args: string[] }): Promise<ExecRequest> {
  const { adapter, profile, providers, command, args } = options;
  const resolvedPath = await shellPathResolver.resolve();
  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};

  return {
    command,
    args,
    env: { ...cleanProcessEnv(), PATH: resolvedPath, ...adapterEnv },
    agentId: adapter.id,
    profileId: profile.id,
  };
}

async function backupCurrentConfig(
  adapter: AgentAdapter,
  scope: LaunchScope,
  cwd?: string,
): Promise<void> {
  const files = adapter.snapshotConfigFiles
    ? await adapter.snapshotConfigFiles(scope, cwd)
    : await snapshotPrimaryConfigFile(adapter, scope, cwd);

  await writeBackup(adapter.id, scope, {
    cwd,
    files: files.map((file) => ({
      ...file,
      format: file.format ?? inferBackupFileFormat(file.path),
    })),
  });
}

async function snapshotPrimaryConfigFile(
  adapter: AgentAdapter,
  scope: LaunchScope,
  cwd?: string,
) {
  const currentConfig = await adapter.readConfig(scope, cwd);
  const configPath = adapter.configPaths(cwd)[scope];

  return [{
    path: configPath,
    format: inferBackupFileFormat(configPath),
    hadFile: currentConfig !== null,
    content: currentConfig,
  }];
}

function createLaunchCleanup(adapter: AgentAdapter, scope: LaunchScope, cwd?: string): () => Promise<void> {
  return async (): Promise<void> => {
    const backup = await readBackup(adapter.id, scope);
    if (backup !== null) {
      await restoreBackupManifest(adapter, backup, scope, cwd);
    }
    await deleteBackup(adapter.id, scope);
  };
}

/**
 * Prepares an agent config launch transaction.
 *
 * The active backup is written before the new config. If backup creation fails
 * (for example because an active backup already exists), the agent config is
 * left untouched.
 */
export async function prepareLaunchTransaction(options: LaunchTransactionOptions): Promise<LaunchTransactionResult> {
  const { adapter, profile, providers, scope, cwd } = options;
  const args = options.args ?? [];

  await backupCurrentConfig(adapter, scope, cwd);

  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  return {
    execReq: await buildExecRequest({ ...options, args }),
    cleanup: createLaunchCleanup(adapter, scope, cwd),
  };
}
