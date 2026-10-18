import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import { resolveBaseModel } from '../adapters/resolve-base-model.js';
import { restoreBackupManifest } from '../config/backup-restore.js';
import { addToGitExclude } from '../config/git-exclude.js';
import type { Profile, Provider } from '../config/schema.js';
import {
  deleteBackup,
  inferBackupFileFormat,
  readBackup,
  readConfig,
  writeBackup,
} from '../config/store.js';
import { getEnvCI, setEnvCI } from '../platform/env.js';
import { startAnthropicScrubberProxy } from '../proxy/anthropic-scrubber.js';
import { startOpenAIProxy } from '../proxy/openai-proxy.js';
import { startResponsesProxy } from '../proxy/responses-proxy.js';
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
  /** Non-fatal notices raised while preparing the launch, for the caller to print. */
  warnings?: string[];
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
  /** Non-fatal notices raised while preparing the launch, for the caller to print. */
  warnings: string[];
}

function cleanProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** Loopback addresses that must never be routed through an external proxy. */
const LOOPBACK_NO_PROXY = '127.0.0.1,localhost,::1';

/**
 * When any proxy env var is active, extends NO_PROXY / no_proxy to include
 * loopback addresses so that child processes (e.g. claude-code) do not route
 * requests to agento's local proxy servers through the external proxy.
 */
function withNoProxyLoopback(
  env: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const hasProxy =
    getEnvCI(env, 'HTTP_PROXY', platform) ??
    getEnvCI(env, 'http_proxy', platform) ??
    getEnvCI(env, 'HTTPS_PROXY', platform) ??
    getEnvCI(env, 'https_proxy', platform) ??
    getEnvCI(env, 'ALL_PROXY', platform) ??
    getEnvCI(env, 'all_proxy', platform);
  if (!hasProxy) return env;

  // Read both spellings before writing: on win32 they are one variable, and reading
  // after the first write would append the loopback list twice.
  const names = ['NO_PROXY', 'no_proxy'] as const;
  const patched = names.map((name) => {
    const existing = getEnvCI(env, name, platform);
    return [name, existing ? `${existing},${LOOPBACK_NO_PROXY}` : LOOPBACK_NO_PROXY] as const;
  });
  const result = { ...env };
  for (const [name, value] of patched) {
    setEnvCI(result, name, value, platform);
  }
  return result;
}

/**
 * Builds the environment the agent process starts with: the current env, the
 * resolved PATH, then the adapter's variables (which may override either), with
 * loopback excluded from any external proxy. On win32 `Path`/`PATH` and other
 * case variants collapse into a single key.
 */
export function buildLaunchEnv(
  baseEnv: Record<string, string>,
  resolvedPath: string,
  adapterEnv: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env = { ...baseEnv };
  setEnvCI(env, 'PATH', resolvedPath, platform);
  for (const [name, value] of Object.entries(adapterEnv)) {
    setEnvCI(env, name, value, platform);
  }
  return withNoProxyLoopback(env, platform);
}

async function buildExecRequest(
  options: LaunchTransactionOptions & { args: string[] },
): Promise<ExecRequest> {
  const { adapter, profile, providers, command, args } = options;
  const resolvedPath = await shellPathResolver.resolve();
  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};

  return {
    command,
    args,
    env: buildLaunchEnv(cleanProcessEnv(), resolvedPath, adapterEnv),
    agentId: adapter.id,
    profileId: profile.id,
  };
}

/** Backs up every config file the launch is about to touch, returning their paths. */
async function backupCurrentConfig(
  adapter: AgentAdapter,
  scope: LaunchScope,
  cwd?: string,
): Promise<string[]> {
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

  return files.map((file) => file.path).filter(Boolean);
}

/**
 * Keeps project-scope agent configs out of git.
 *
 * Several adapters embed the provider API key in the config they generate, and
 * in `project` scope that config lands inside the user's repository — often at a
 * path that is conventionally committed. Excluding it locally turns a silent
 * secret leak into a no-op. Paths outside the repo are ignored by
 * {@link addToGitExclude}, so passing the whole snapshot list is safe.
 */
async function excludeProjectConfigsFromGit(
  paths: string[],
  scope: LaunchScope,
  cwd: string | undefined,
): Promise<string[]> {
  if (scope !== 'project' || !cwd || paths.length === 0) return [];

  const { added, error } = await addToGitExclude(cwd, paths);
  if (error) {
    return [
      `Could not update .git/info/exclude (${error}). The generated agent config may contain your API key — do not commit it.`,
    ];
  }
  if (added.length === 0) return [];

  return [
    `Generated agent config may contain your API key; added to .git/info/exclude so it is not committed: ${added.join(', ')}`,
  ];
}

async function snapshotPrimaryConfigFile(adapter: AgentAdapter, scope: LaunchScope, cwd?: string) {
  const currentConfig = await adapter.readConfig(scope, cwd);
  const configPath = adapter.configPaths(cwd)[scope];

  return [
    {
      path: configPath,
      format: inferBackupFileFormat(configPath),
      hadFile: currentConfig !== null,
      content: currentConfig,
    },
  ];
}

/**
 * Starts a local proxy when the provider requires protocol translation.
 * For openai-compatible providers, starts the OpenAI→Anthropic bidirectional proxy.
 * For fireworks/openrouter/custom-api (anthropic mode), starts the anthropic scrubber proxy.
 */
async function maybeStartProxy(
  adapter: AgentAdapter,
  profile: Profile,
  providers: Provider[],
  scope: LaunchScope,
  cwd: string | undefined,
  writtenConfig: Record<string, unknown>,
): Promise<(() => Promise<void>) | undefined> {
  if (adapter.id !== 'claude-code') return;

  const { provider } = resolveBaseModel(profile, providers);
  if (provider.type === 'anthropic-compatible') return;

  const rawEnv = writtenConfig.env;
  const env =
    typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv)
      ? (rawEnv as Record<string, unknown>)
      : undefined;
  const upstream = env?.['ANTHROPIC_BASE_URL'];
  if (!upstream || typeof upstream !== 'string') return;

  const needsResponsesProxy =
    provider.type === 'responses-compatible' ||
    (provider.type === 'custom-api' &&
      !!provider.customApiModes?.responses &&
      !provider.customApiModes?.anthropic &&
      !provider.customApiModes?.openai);
  const needsOpenAIProxy =
    !needsResponsesProxy &&
    (provider.type === 'openai-compatible' ||
      (provider.type === 'custom-api' &&
        !!provider.customApiModes?.openai &&
        !provider.customApiModes?.anthropic));
  const proxy = needsResponsesProxy
    ? await startResponsesProxy({ upstreamUrl: upstream })
    : needsOpenAIProxy
      ? await startOpenAIProxy({ upstreamUrl: upstream })
      : await startAnthropicScrubberProxy({ upstreamUrl: upstream });

  const newConfig = { ...writtenConfig, env: { ...env, ANTHROPIC_BASE_URL: proxy.url } };
  await adapter.writeConfig(newConfig, scope, cwd, false);

  return proxy.stop;
}

function createLaunchCleanup(
  adapter: AgentAdapter,
  scope: LaunchScope,
  cwd?: string,
): () => Promise<void> {
  return async (): Promise<void> => {
    const backup = await readBackup(adapter.id, scope, cwd);
    if (backup !== null) {
      await restoreBackupManifest(adapter, backup, scope, cwd);
    }
    await deleteBackup(adapter.id, scope, cwd);
  };
}

/**
 * Prepares an agent config launch transaction.
 *
 * The active backup is written before the new config. If backup creation fails
 * (for example because an active backup already exists), the agent config is
 * left untouched.
 *
 * The `mergeAgentConfigs` setting from AgentO config is passed to the adapter
 * so JSON-based configs can be merged conservatively rather than overwritten.
 */
export async function prepareLaunchTransaction(
  options: LaunchTransactionOptions,
): Promise<LaunchTransactionResult> {
  const { adapter, profile, providers, scope, cwd } = options;
  const args = options.args ?? [];

  const configPaths = await backupCurrentConfig(adapter, scope, cwd);

  const newConfig = adapter.buildConfig(profile, providers);
  const agentoConfig = await readConfig();
  await adapter.writeConfig(newConfig, scope, cwd, agentoConfig.settings.mergeAgentConfigs);

  const warnings = await excludeProjectConfigsFromGit(configPaths, scope, cwd);

  const execReq = await buildExecRequest({ ...options, args });
  const stopProxy = await maybeStartProxy(adapter, profile, providers, scope, cwd, newConfig);
  const baseCleanup = createLaunchCleanup(adapter, scope, cwd);

  const cleanup = async (): Promise<void> => {
    if (stopProxy) {
      await stopProxy();
    }
    await baseCleanup();
  };

  return { execReq: { ...execReq, warnings }, cleanup, warnings };
}
