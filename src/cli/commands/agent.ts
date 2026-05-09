import { Command } from 'commander';
import { backupExists } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import { qwenAdapter } from '../../adapters/qwen.js';
import { codexAdapter } from '../../adapters/codex.js';
import type { AgentAdapter } from '../../adapters/base.js';

const ALL_ADAPTERS: AgentAdapter[] = [claudeCodeAdapter, openCodeAdapter, qwenAdapter, codexAdapter];

function getAdapters(dev = false): AgentAdapter[] {
  if (dev) return ALL_ADAPTERS;
  return ALL_ADAPTERS.filter((a) => !a.dev);
}

export function createAgentCommand(): Command {
  const cmd = new Command('agent').description('Agent config status');

  cmd
    .command('status')
    .description('Show status of agent configs')
    .option('-d, --dev', 'Show development agents (e.g. codex)')
    .action(async (opts: { dev?: boolean }) => {
      try {
        const adapters = getAdapters(opts.dev);
        for (const adapter of adapters) {
          const scopes: Array<'global' | 'project'> = ['global', 'project'];
          for (const scope of scopes) {
            const paths = adapter.configPaths();
            const configPath = paths[scope];
            const hasBackup = backupExists(adapter.id, scope);
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
