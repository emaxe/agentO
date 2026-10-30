/**
 * CLI command: `agento agent`
 *
 * Subcommand: status — shows whether each agent config is original or modified
 * (i.e. a backup exists), plus the detected installed version.
 */
import { Command } from 'commander';
import { backupExists } from '../../config/store.js';
import { getAgentInstaller, listAgents } from '../../agents/registry.js';
import type { LaunchScope } from '../../config/schema.js';

function resolveDevOption(command: Command, optionValue?: boolean): boolean {
  if (optionValue) return true;

  let current: Command | null = command;
  while (current) {
    if (current.opts<{ dev?: boolean }>().dev === true) return true;
    current = current.parent;
  }

  return false;
}

interface ScopeStatus {
  configPath: string;
  backup: boolean;
}

interface AgentStatusEntry {
  id: string;
  label: string;
  command: string;
  installed: boolean;
  version?: string;
  scopes: Record<LaunchScope, ScopeStatus>;
}

async function collectStatus(dev: boolean): Promise<AgentStatusEntry[]> {
  const cwd = process.cwd();
  return Promise.all(
    listAgents({ dev }).map(async (agent) => {
      const installer = getAgentInstaller(agent.id, { dev: true });
      let installed = false;
      let version: string | undefined;
      if (installer) {
        try {
          const result = await installer.checkInstalled();
          installed = result.installed;
          version = result.version;
        } catch {
          installed = false;
        }
      }

      const paths = agent.adapter.configPaths(cwd);
      const scopes = {
        global: {
          configPath: paths.global,
          backup: backupExists(agent.id, 'global', cwd),
        },
        project: {
          configPath: paths.project,
          backup: backupExists(agent.id, 'project', cwd),
        },
      } satisfies Record<LaunchScope, ScopeStatus>;

      return {
        id: agent.id,
        label: agent.label,
        command: agent.command,
        installed,
        ...(version ? { version } : {}),
        scopes,
      };
    }),
  );
}

/** Builds the `agent` CLI command. */
export function createAgentCommand(): Command {
  const cmd = new Command('agent').description('Agent config status');

  cmd
    .command('status')
    .description('Show status of agent configs and installed agents')
    .option('-d, --dev', 'Deprecated: accepted for compatibility; all agents are shown')
    .option('--json', 'Output JSON')
    .action(async (opts: { dev?: boolean; json?: boolean }, command: Command) => {
      const dev = resolveDevOption(command, opts.dev);
      try {
        const entries = await collectStatus(dev);
        if (opts.json) {
          console.log(JSON.stringify({ agents: entries }, null, 2));
        } else {
          for (const entry of entries) {
            const version = entry.installed
              ? entry.version
                ? ` v${entry.version}`
                : ' (installed)'
              : ' (not installed)';
            console.log(`  ${entry.label} (${entry.id})${version}`);
            for (const scope of ['global', 'project'] as const) {
              const status = entry.scopes[scope];
              const state = status.backup ? 'modified (backup exists)' : 'original';
              console.log(`    ${scope}: ${state} — ${status.configPath}`);
            }
          }
        }
        process.exitCode = 0;
        return;
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
