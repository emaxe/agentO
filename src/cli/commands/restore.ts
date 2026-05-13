/**
 * CLI command: `agento restore`
 *
 * Restores an agent's config from the backup created before a launch.
 * Supports every registered adapter through the generic `writeConfig` path.
 */
import { Command } from 'commander';
import { readBackup, backupExists, deleteBackup } from '../../config/store.js';
import { restorePrimaryBackupFile } from '../../config/backup-restore.js';
import { getAgent, listAgents } from '../../agents/registry.js';
import { LaunchScopeSchema } from '../../config/schema.js';

const SUPPORTED_AGENT_IDS = listAgents({ dev: true }).map((agent) => agent.id).join(', ');
const SUPPORTED_SCOPES = LaunchScopeSchema.options.join(', ');

/** Builds the `restore` CLI command. */
export function createRestoreCommand(): Command {
  return new Command('restore')
    .description('Restore agent config from backup')
    .requiredOption('-a, --agent <id>', `Agent id (${SUPPORTED_AGENT_IDS})`)
    .requiredOption('-s, --scope <scope>', `Config scope: ${SUPPORTED_SCOPES}`)
    .action(async (opts: { agent: string; scope: string }) => {
      try {
        const agent = getAgent(opts.agent, { dev: true });
        if (!agent) {
          console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${SUPPORTED_AGENT_IDS}`);
          return process.exit(1);
        }

        const scopeResult = LaunchScopeSchema.safeParse(opts.scope);
        if (!scopeResult.success) {
          console.error(`Error: Invalid scope: ${opts.scope}. Supported: ${SUPPORTED_SCOPES}`);
          return process.exit(1);
        }
        const scope = scopeResult.data;

        if (!backupExists(opts.agent, scope)) {
          console.error(`Error: No backup found for ${opts.agent} (${scope})`);
          return process.exit(1);
        }

        const backup = await readBackup(opts.agent, scope);
        if (backup === null) {
          console.error(`Error: Backup is empty for ${opts.agent} (${scope})`);
          return process.exit(1);
        }

        await restorePrimaryBackupFile(agent.adapter, backup, scope);
        await deleteBackup(opts.agent, scope);
        console.log(`Restored ${opts.agent} config (${scope})`);
        return process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        return process.exit(1);
      }
    });
}
