/**
 * CLI command: `agento restore`
 *
 * Restores an agent's config from the backup created before a launch.
 * Supports every registered adapter through the generic `writeConfig` path.
 *
 * `-s` is inferred when only one scope has an active backup for the agent, and
 * `-a` is inferred when exactly one agent/scope pair is active. `--list` shows
 * what is available without restoring anything.
 */
import { Command } from 'commander';
import { readBackup, backupExists, deleteBackup, getBackupPath } from '../../config/store.js';
import { restoreBackupManifest } from '../../config/backup-restore.js';
import { withConfigOperation } from '../../config/config-operation.js';
import { getAgent, listAgents } from '../../agents/registry.js';
import { LaunchScopeSchema, type LaunchScope } from '../../config/schema.js';

const SUPPORTED_AGENT_IDS = listAgents({ dev: true })
  .map((agent) => agent.id)
  .join(', ');
const SUPPORTED_SCOPES = LaunchScopeSchema.options.join(', ');

interface ActiveBackup {
  agentId: string;
  displayName: string;
  scope: LaunchScope;
  path: string;
}

function activeBackups(cwd: string): ActiveBackup[] {
  const result: ActiveBackup[] = [];
  for (const agent of listAgents({ dev: true })) {
    for (const scope of LaunchScopeSchema.options) {
      if (backupExists(agent.id, scope, cwd)) {
        result.push({
          agentId: agent.id,
          displayName: agent.label,
          scope,
          path: getBackupPath(agent.id, scope, cwd),
        });
      }
    }
  }
  return result;
}

function resolveAgentRef(ref: string): string | undefined {
  const lower = ref.toLowerCase();
  const agents = listAgents({ dev: true });
  const exact = agents.find(
    (agent) => agent.id.toLowerCase() === lower || agent.label.toLowerCase() === lower,
  );
  if (exact) return exact.id;
  const matches = agents.filter(
    (agent) =>
      agent.id.toLowerCase().startsWith(lower) || agent.label.toLowerCase().startsWith(lower),
  );
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    throw new Error(`Ambiguous agent "${ref}": ${matches.map((agent) => agent.id).join(', ')}`);
  }
  return undefined;
}

async function restoreOne(agentId: string, scope: LaunchScope, cwd: string): Promise<void> {
  return withConfigOperation(() => restoreOneUnlocked(agentId, scope, cwd));
}

async function restoreOneUnlocked(agentId: string, scope: LaunchScope, cwd: string): Promise<void> {
  const agent = getAgent(agentId, { dev: true });
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Supported: ${SUPPORTED_AGENT_IDS}`);
  }
  if (!backupExists(agentId, scope, cwd)) {
    throw new Error(`No backup found for ${agentId} (${scope})`);
  }
  const backup = await readBackup(agentId, scope, cwd);
  if (backup === null) {
    throw new Error(`Backup is empty for ${agentId} (${scope})`);
  }
  await restoreBackupManifest(agent.adapter, backup, scope, cwd);
  await deleteBackup(agentId, scope, cwd);
  console.log(`Restored ${agentId} config (${scope})`);
}

/** Builds the `restore` CLI command. */
export function createRestoreCommand(): Command {
  return new Command('restore')
    .description('Restore agent config from backup')
    .option('-a, --agent <id>', `Agent id or label (${SUPPORTED_AGENT_IDS})`)
    .option('-s, --scope <scope>', `Config scope: ${SUPPORTED_SCOPES}`)
    .option('-l, --list', 'List active backups for the current directory')
    .action(async (opts: { agent?: string; scope?: string; list?: boolean }) => {
      try {
        const restoreCwd = process.cwd();
        const active = opts.list || !opts.agent || !opts.scope ? activeBackups(restoreCwd) : [];

        if (opts.list) {
          if (active.length === 0) {
            console.log('No active backups for the current directory.');
          } else {
            for (const entry of active) {
              console.log(
                `  ${entry.displayName} (${entry.agentId}) [${entry.scope}] — ${entry.path}`,
              );
            }
          }
          process.exitCode = 0;
          return;
        }

        let agentId = opts.agent ? resolveAgentRef(opts.agent) : undefined;
        if (opts.agent && !agentId) {
          console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${SUPPORTED_AGENT_IDS}`);
          return process.exit(1);
        }

        if (!agentId) {
          if (active.length === 1) {
            agentId = active[0]!.agentId;
            console.error(
              `Note: restoring the only active backup (${active[0]!.agentId} [${active[0]!.scope}]).`,
            );
          } else if (active.length === 0) {
            console.error(
              'Error: No active backups for the current directory. Use --list to check.',
            );
            return process.exit(1);
          } else {
            console.error(
              'Error: multiple active backups; specify -a and -s or run "agento restore --list".',
            );
            return process.exit(1);
          }
        }

        let scope: LaunchScope;
        if (opts.scope) {
          const scopeResult = LaunchScopeSchema.safeParse(opts.scope);
          if (!scopeResult.success) {
            console.error(`Error: Invalid scope: ${opts.scope}. Supported: ${SUPPORTED_SCOPES}`);
            return process.exit(1);
          }
          scope = scopeResult.data;
        } else {
          const scopes = active
            .filter((entry) => entry.agentId === agentId)
            .map((entry) => entry.scope);
          if (scopes.length === 1) {
            scope = scopes[0]!;
            console.error(`Note: using the only active backup scope (${scope}).`);
          } else if (scopes.length === 0) {
            console.error(`Error: No backup found for ${agentId}. Use --list to check.`);
            return process.exit(1);
          } else {
            console.error(
              `Error: ${agentId} has backups in ${scopes.join(' and ')}; specify -s <scope>.`,
            );
            return process.exit(1);
          }
        }

        if (!backupExists(agentId, scope, restoreCwd)) {
          console.error(`Error: No backup found for ${agentId} (${scope})`);
          return process.exit(1);
        }

        await restoreOne(agentId, scope, restoreCwd);
        process.exitCode = 0;
        return;
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        return process.exit(1);
      }
    });
}
