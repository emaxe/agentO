/**
 * CLI command: `agento launch`
 *
 * Validates profile / agent / provider compatibility and delegates to either
 * child-mode (backup → patch → spawn → restore) or independent-mode launch.
 */
import { Command } from 'commander';
import { readConfig } from '../../config/store.js';
import { getAgentCommand, listAgents } from '../../agents/registry.js';
import { describeIncompatibility } from '../../agents/compatibility.js';
import { launchChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import { LaunchModeSchema, LaunchScopeSchema } from '../../config/schema.js';
import { spawnCommandSync } from '../../platform/spawn.js';

const SUPPORTED_AGENT_IDS = listAgents({ dev: true })
  .map((agent) => agent.id)
  .join(', ');

function resolveDevOption(command: Command, optionValue?: boolean): boolean {
  if (optionValue) return true;

  let current: Command | null = command;
  while (current) {
    if (current.opts<{ dev?: boolean }>().dev === true) return true;
    current = current.parent;
  }

  return false;
}

/** Builds the `launch` CLI command with all required options and validation. */
export function createLaunchCommand(): Command {
  const cmd = new Command('launch')
    .description('Launch an agent with a profile')
    .requiredOption('-p, --profile <name>', 'Profile name to use')
    .requiredOption('-a, --agent <id>', `Agent to launch (${SUPPORTED_AGENT_IDS})`)
    .option('-m, --mode <mode>', 'Launch mode: child or independent')
    .option('-s, --scope <scope>', 'Config scope: global or project')
    .option('-d, --dev', 'Show development agents (e.g. codex)')
    .action(
      async (
        opts: { profile: string; agent: string; mode?: string; scope?: string; dev?: boolean },
        command: Command,
      ) => {
        const dev = resolveDevOption(command, opts.dev);
        try {
          const config = await readConfig();

          // Resolve profile by name or id
          const profile = config.profiles.find(
            (p) => p.name === opts.profile || p.id === opts.profile,
          );
          if (!profile) {
            console.error(`Error: Profile not found: ${opts.profile}`);
            process.exit(1);
          }

          // Resolve agent adapter and command
          const agentEntry = getAgentCommand(opts.agent, { dev });
          if (!agentEntry) {
            const supported = listAgents({ dev })
              .map((agent) => agent.id)
              .join(', ');
            console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${supported}`);
            process.exit(1);
          }

          // Resolve mode and scope, falling back to user settings; validate at runtime
          const rawMode = opts.mode ?? config.settings.defaultLaunchMode;
          const modeResult = LaunchModeSchema.safeParse(rawMode);
          if (!modeResult.success) {
            console.error(
              `Error: Invalid mode: ${rawMode}. Supported: ${LaunchModeSchema.options.join(', ')}`,
            );
            return process.exit(1);
          }
          const mode = modeResult.data;

          const rawScope = opts.scope ?? config.settings.defaultConfigScope;
          const scopeResult = LaunchScopeSchema.safeParse(rawScope);
          if (!scopeResult.success) {
            console.error(
              `Error: Invalid scope: ${rawScope}. Supported: ${LaunchScopeSchema.options.join(', ')}`,
            );
            return process.exit(1);
          }
          const scope = scopeResult.data;

          const { adapter, command, args } = agentEntry;

          // Same gate the TUI wizard uses to decide which agents to offer, so the
          // two never disagree about what is launchable.
          const incompatible = describeIncompatibility(adapter, profile, config.providers);
          if (incompatible) {
            console.error(`Error: ${incompatible}`);
            process.exit(1);
          }

          const launchCwd = process.cwd();
          if (mode === 'child') {
            const exitCode = await launchChild({
              adapter,
              profile,
              providers: config.providers,
              scope,
              command,
              args,
              cwd: launchCwd,
            });
            process.exit(exitCode);
          } else {
            const execReq = await launchIndependent({
              adapter,
              profile,
              providers: config.providers,
              scope,
              command,
              args,
              cwd: launchCwd,
            });
            for (const warning of execReq.warnings ?? []) {
              console.warn(`Warning: ${warning}`);
            }
            const result = spawnCommandSync(execReq.command, execReq.args, {
              stdio: 'inherit',
              env: execReq.env,
              cwd: launchCwd,
            });
            if (result.error) {
              const code = (result.error as NodeJS.ErrnoException).code;
              console.error(
                `Error: failed to start "${execReq.command}": ${result.error.message}`,
              );
              process.exit(code === 'ENOENT' ? 127 : 1);
            }
            process.exit(result.status ?? 1);
          }
        } catch (err) {
          console.error('Error:', err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  return cmd;
}
