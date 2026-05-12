/**
 * CLI command: `agento restore`
 *
 * Restores an agent's config from the backup created before a launch.
 * Supports claude-code and opencode adapters (legacy subset — all adapters
 * support backup/restore through the generic `writeConfig` path).
 */
import { Command } from 'commander';
import { readBackup, backupExists } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import type { AgentAdapter, LaunchScope } from '../../adapters/base.js';

const ADAPTERS: Record<string, AgentAdapter> = {
  'claude-code': claudeCodeAdapter,
  'opencode': openCodeAdapter,
};

/** Builds the `restore` CLI command. */
export function createRestoreCommand(): Command {
  return new Command('restore')
    .description('Restore agent config from backup')
    .requiredOption('-a, --agent <id>', 'Agent id (claude-code, opencode)')
    .requiredOption('-s, --scope <scope>', 'Config scope: global or project')
    .action(async (opts: { agent: string; scope: string }) => {
      try {
        const adapter = ADAPTERS[opts.agent];
        if (!adapter) {
          console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${Object.keys(ADAPTERS).join(', ')}`);
          process.exit(1);
        }

        const scope = opts.scope as LaunchScope;
        if (!backupExists(opts.agent, scope)) {
          console.error(`Error: No backup found for ${opts.agent} (${scope})`);
          process.exit(1);
        }

        const backup = await readBackup(opts.agent, scope);
        if (backup === null) {
          console.error(`Error: Backup is empty for ${opts.agent} (${scope})`);
          process.exit(1);
        }

        await adapter.writeConfig(backup as Record<string, unknown>, scope);
        console.log(`Restored ${opts.agent} config (${scope})`);
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
