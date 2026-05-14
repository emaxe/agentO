/**
 * CLI command: `agento launch`
 *
 * Validates profile / agent / provider compatibility and delegates to either
 * child-mode (backup → patch → spawn → restore) or independent-mode launch.
 */
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../../config/store.js';
import { getAgentCommand, listAgents } from '../../agents/registry.js';
import { launchChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import { type ProviderType, LaunchModeSchema, LaunchScopeSchema } from '../../config/schema.js';

const SUPPORTED_AGENT_IDS = listAgents({ dev: true }).map((agent) => agent.id).join(', ');

function resolveDevOption(command: Command, optionValue?: boolean): boolean {
  if (optionValue) return true;

  let current: Command | null = command;
  while (current) {
    if ((current.opts<{ dev?: boolean }>().dev) === true) return true;
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
    .action(async (opts: { profile: string; agent: string; mode?: string; scope?: string; dev?: boolean }, command: Command) => {
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
          const supported = listAgents({ dev }).map((agent) => agent.id).join(', ');
          console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${supported}`);
          process.exit(1);
        }

        // Resolve mode and scope, falling back to user settings; validate at runtime
        const rawMode = opts.mode ?? config.settings.defaultLaunchMode;
        const modeResult = LaunchModeSchema.safeParse(rawMode);
        if (!modeResult.success) {
          console.error(`Error: Invalid mode: ${rawMode}. Supported: ${LaunchModeSchema.options.join(', ')}`);
          return process.exit(1);
        }
        const mode = modeResult.data;

        const rawScope = opts.scope ?? config.settings.defaultConfigScope;
        const scopeResult = LaunchScopeSchema.safeParse(rawScope);
        if (!scopeResult.success) {
          console.error(`Error: Invalid scope: ${rawScope}. Supported: ${LaunchScopeSchema.options.join(', ')}`);
          return process.exit(1);
        }
        const scope = scopeResult.data;

        const { adapter, command, args } = agentEntry;

        // Validate provider compatibility for every model in the profile
        const unsupported: ProviderType[] = [];
        for (const model of profile.models) {
          const provider = config.providers.find((p) => p.id === model.providerId);
          if (provider && !(adapter.supportedProviderTypes as readonly string[]).includes(provider.type)) {
            unsupported.push(provider.type);
          }
        }
        if (unsupported.length > 0) {
          console.error(
            `Error: ${adapter.displayName} does not support provider type(s): ${[...new Set(unsupported)].join(', ')}. ` +
            `Supported: ${adapter.supportedProviderTypes.join(', ')}`
          );
          process.exit(1);
        }

        // Deep compatibility check (e.g. custom-api modes)
        try {
          adapter.buildConfig(profile, config.providers);
        } catch (err) {
          console.error(
            `Error: ${adapter.displayName} is not compatible with profile "${profile.name}": ${err instanceof Error ? err.message : String(err)}`
          );
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
          spawnSync(execReq.command, execReq.args, { stdio: 'inherit', env: execReq.env });
          process.exit(0);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
