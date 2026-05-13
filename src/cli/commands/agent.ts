/**
 * CLI command: `agento agent`
 *
 * Subcommand: status — shows whether each agent config is original or modified
 * (i.e. a backup exists).
 */
import { Command } from 'commander';
import { backupExists } from '../../config/store.js';
import { listAdapters } from '../../agents/registry.js';

function resolveDevOption(command: Command, optionValue?: boolean): boolean {
  if (optionValue) return true;

  let current: Command | null = command;
  while (current) {
    if ((current.opts<{ dev?: boolean }>().dev) === true) return true;
    current = current.parent;
  }

  return false;
}

/** Builds the `agent` CLI command. */
export function createAgentCommand(): Command {
  const cmd = new Command('agent').description('Agent config status');

  cmd
    .command('status')
    .description('Show status of agent configs')
    .option('-d, --dev', 'Show development agents (e.g. codex)')
    .action(async (opts: { dev?: boolean }, command: Command) => {
      const dev = resolveDevOption(command, opts.dev);
      try {
        const adapters = listAdapters({ dev });
        for (const adapter of adapters) {
          const scopes: Array<'global' | 'project'> = ['global', 'project'];
          for (const scope of scopes) {
            const paths = adapter.configPaths(process.cwd());
            const configPath = paths[scope];
            const hasBackup = backupExists(adapter.id, scope, process.cwd());
            const status = hasBackup ? 'modified (backup exists)' : 'original';
            console.log(`  ${adapter.displayName} [${scope}]: ${status}`);
            console.log(`    config: ${configPath}`);
          }
        }
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
