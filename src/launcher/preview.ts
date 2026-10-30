/**
 * Read-only description of what a launch would change.
 *
 * Used by the TUI preview (`v` in the agent picker) and `agento launch
 * --dry-run`. It deliberately calls only side-effect-free adapter methods:
 * `buildConfig` / `buildEnv` are pure, `snapshotConfigFiles` reads existing
 * files, and the git-exclude check resolves patterns without writing them.
 */
import { existsSync } from 'node:fs';
import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import { resolveBaseModel } from '../adapters/resolve-base-model.js';
import type { LaunchMode, Profile, Provider } from '../config/schema.js';
import { backupExists, getBackupPath, readBackup, type BackupManifest } from '../config/store.js';
import { findGitRoot, toExcludePattern } from '../config/git-exclude.js';
import { isProcessAlive } from './transaction.js';

export interface LaunchPreviewFile {
  path: string;
  action: 'create' | 'update';
}

export interface LaunchPreview {
  agentId: string;
  agentLabel: string;
  profileName: string;
  cwd: string;
  model: string;
  providerName: string;
  mode: LaunchMode;
  scope: LaunchScope;
  envOnly: boolean;
  files: LaunchPreviewFile[];
  envKeys: string[];
  backup: {
    active: boolean;
    path?: string;
    stale?: boolean;
  };
  gitExclude: string[];
  warnings: string[];
}

export interface DescribeLaunchOptions {
  adapter: AgentAdapter;
  agentLabel?: string;
  profile: Profile;
  providers: Provider[];
  mode: LaunchMode;
  scope: LaunchScope;
  cwd?: string;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

async function filesFor(adapter: AgentAdapter, scope: LaunchScope, cwd: string): Promise<string[]> {
  if (adapter.envOnly) return [];
  if (adapter.snapshotConfigFiles) {
    const snapshot = await adapter.snapshotConfigFiles(scope, cwd);
    return uniquePaths(snapshot.map((file) => file.path));
  }
  return uniquePaths([adapter.configPaths(cwd)[scope]]);
}

function staleBackup(manifest: BackupManifest | null): boolean {
  return Boolean(
    manifest?.pid !== undefined && Number.isInteger(manifest.pid) && !isProcessAlive(manifest.pid),
  );
}

/** Builds the preview without touching disk (other than reads). */
export async function describeLaunch(options: DescribeLaunchOptions): Promise<LaunchPreview> {
  const { adapter, profile, providers, mode, scope } = options;
  const cwd = options.cwd ?? process.cwd();
  const agentLabel = options.agentLabel ?? adapter.displayName;

  // Both throw on a broken profile; the caller runs compatibility checks first.
  adapter.buildConfig(profile, providers);
  const envKeys = Object.keys(adapter.buildEnv?.(profile, providers) ?? {});

  const paths = await filesFor(adapter, scope, cwd);
  const files = paths.map((path) => ({
    path,
    action: (existsSync(path) ? 'update' : 'create') as LaunchPreviewFile['action'],
  }));

  const active = backupExists(adapter.id, scope, cwd);
  const backupPath = active ? getBackupPath(adapter.id, scope, cwd) : undefined;
  const manifest = active ? await readBackup(adapter.id, scope, cwd) : null;
  const stale = active ? staleBackup(manifest) : undefined;

  const gitRoot = scope === 'project' && files.length > 0 ? findGitRoot(cwd) : null;
  const gitExclude = gitRoot
    ? files
        .map((file) => toExcludePattern(gitRoot, file.path))
        .filter((pattern): pattern is string => pattern !== null)
    : [];

  const warnings: string[] = [];
  if (adapter.envOnly) {
    warnings.push(
      'Configuration is delivered through environment variables; no config file is written.',
    );
  }
  if (active) {
    warnings.push(
      stale
        ? 'A stale backup from a previous session will be restored automatically before patching.'
        : `An active backup already exists (${backupPath}); the launch will stop until you run "agento restore -a ${adapter.id} -s ${scope}".`,
    );
  }
  if (scope === 'project' && files.length > 0) {
    if (gitExclude.length > 0) {
      warnings.push(
        `Generated config may contain your API key; it will be added to .git/info/exclude: ${gitExclude.join(', ')}`,
      );
    } else if (!gitRoot) {
      warnings.push(
        'Current directory is not inside a git repository; generated config is not excluded from version control.',
      );
    }
  }
  if (adapter.id === 'claude-code') {
    try {
      const { provider } = resolveBaseModel(profile, providers);
      if (provider.type !== 'anthropic-compatible') {
        warnings.push(
          `A local protocol-translation proxy will be started for Claude Code (${provider.type}).`,
        );
      }
    } catch {
      /* compatibility check already reported a broken profile */
    }
  }

  return {
    agentId: adapter.id,
    agentLabel,
    profileName: profile.name,
    cwd,
    model: resolveBaseModel(profile, providers).model.model,
    providerName: resolveBaseModel(profile, providers).provider.name,
    mode,
    scope,
    envOnly: Boolean(adapter.envOnly),
    files,
    envKeys,
    backup: {
      active,
      ...(backupPath ? { path: backupPath } : {}),
      ...(stale !== undefined ? { stale } : {}),
    },
    gitExclude,
    warnings,
  };
}

/** Human-readable lines shared by the TUI preview and `launch --dry-run`. */
export function describePreviewLines(preview: LaunchPreview): string[] {
  const lines = [
    `Agent:    ${preview.agentLabel} (${preview.agentId})`,
    `Profile:  ${preview.profileName}`,
    `Model:    ${preview.model} (${preview.providerName})`,
    `Directory: ${preview.cwd}`,
    `Mode:     ${preview.mode} — ${preview.mode === 'child' ? 'config is restored when the agent exits' : 'config stays patched; restore later'}`,
    `Scope:    ${preview.scope} — ${preview.scope === 'global' ? 'home directory config (all projects)' : 'adapter-selected files listed below; may include home directory config'}`,
  ];

  if (preview.envOnly) {
    lines.push('Config:   environment variables only (no file is written)');
  } else if (preview.files.length === 0) {
    lines.push('Config:   nothing to write');
  } else {
    lines.push('Files:');
    for (const file of preview.files) {
      lines.push(`  ${file.action === 'create' ? 'create' : 'update'}  ${file.path}`);
    }
  }

  lines.push(`Env:      ${preview.envKeys.length > 0 ? preview.envKeys.join(', ') : '(none)'}`);
  lines.push(
    `Backup:   ${
      preview.backup.active
        ? `active${preview.backup.stale ? ' (stale, will be recovered)' : ''} — ${preview.backup.path}`
        : 'none'
    }`,
  );
  if (preview.gitExclude.length > 0) {
    lines.push(`Git:      exclude ${preview.gitExclude.join(', ')}`);
  }

  return lines;
}
