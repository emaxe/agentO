/**
 * CLI command: `agento launch`
 *
 * Validates profile / agent / provider compatibility and delegates to either
 * child-mode (backup → patch → spawn → restore) or independent-mode launch.
 */
import { Command } from 'commander';
import { readConfig } from '../../config/store.js';
import { readUiState } from '../../config/ui-state.js';
import { getAgentCommand, listAgents } from '../../agents/registry.js';
import { describeIncompatibility } from '../../agents/compatibility.js';
import { launchChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import { describeLaunch, describePreviewLines } from '../../launcher/preview.js';
import { LaunchModeSchema, LaunchScopeSchema, type Profile } from '../../config/schema.js';
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

/** Case-insensitive exact match, then a unique name prefix. */
function resolveProfileRef(profiles: readonly Profile[], ref: string): Profile | undefined {
  const lower = ref.toLowerCase();
  const exact = profiles.find(
    (profile) => profile.id.toLowerCase() === lower || profile.name.toLowerCase() === lower,
  );
  if (exact) return exact;
  const matches = profiles.filter((profile) => profile.name.toLowerCase().startsWith(lower));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous profile "${ref}": ${matches.map((profile) => profile.name).join(', ')}`,
    );
  }
  return undefined;
}

/** Agent ids are lower-case; labels and unique prefixes are accepted too. */
function resolveAgentRef(ref: string, dev: boolean): string | undefined {
  const agents = listAgents({ dev });
  const lower = ref.toLowerCase();
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

/** Builds the `launch` CLI command with all required options and validation. */
export function createLaunchCommand(): Command {
  const cmd = new Command('launch')
    .description('Launch an agent with a profile')
    .option('-p, --profile <name>', 'Profile name or id (default: last launch)')
    .option('-a, --agent <id>', `Agent id or label (default: last launch) (${SUPPORTED_AGENT_IDS})`)
    .option('-m, --mode <mode>', 'Launch mode: child or independent')
    .option('-s, --scope <scope>', 'Config scope: global or project')
    .option('-d, --dev', 'Deprecated: accepted for compatibility; all agents are shown')
    .option('--dry-run', 'Print what would be patched without writing anything')
    .action(
      async (
        opts: {
          profile?: string;
          agent?: string;
          mode?: string;
          scope?: string;
          dev?: boolean;
          dryRun?: boolean;
        },
        command: Command,
      ) => {
        const dev = resolveDevOption(command, opts.dev);
        try {
          const config = await readConfig();
          const ui = await readUiState();
          const last = ui.lastLaunch;
          const usingLast = !opts.profile || !opts.agent;
          const profileRef = opts.profile ?? last?.profileId;
          const agentRef = opts.agent ?? last?.agentId;

          if (!profileRef || !agentRef) {
            console.error(
              'Error: specify -p <profile> and -a <agent>, or run "agento" for the interactive picker.',
            );
            return process.exit(1);
          }
          if (usingLast) {
            console.error(`Note: using the last launch (${profileRef} → ${agentRef}).`);
          }

          const profile = resolveProfileRef(config.profiles, profileRef);
          if (!profile) {
            const available = config.profiles.map((candidate) => candidate.name).join(', ');
            console.error(
              `Error: Profile not found: ${profileRef}.${available ? ` Available: ${available}` : ' No profiles configured.'}`,
            );
            process.exit(1);
          }

          const resolvedAgentId = resolveAgentRef(agentRef, dev);
          const agentEntry = resolvedAgentId
            ? getAgentCommand(resolvedAgentId, { dev })
            : undefined;
          if (!agentEntry) {
            const supported = listAgents({ dev })
              .map((agent) => agent.id)
              .join(', ');
            console.error(`Error: Unknown agent: ${agentRef}. Supported: ${supported}`);
            process.exit(1);
          }

          // Resolve mode and scope: explicit flag, then last launch, then settings.
          const rawMode =
            opts.mode ?? (usingLast ? last?.mode : undefined) ?? config.settings.defaultLaunchMode;
          const modeResult = LaunchModeSchema.safeParse(rawMode);
          if (!modeResult.success) {
            console.error(
              `Error: Invalid mode: ${rawMode}. Supported: ${LaunchModeSchema.options.join(', ')}`,
            );
            return process.exit(1);
          }
          const mode = modeResult.data;

          const rawScope =
            opts.scope ??
            (usingLast ? last?.scope : undefined) ??
            config.settings.defaultConfigScope;
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
          if (opts.dryRun) {
            const preview = await describeLaunch({
              adapter,
              agentLabel: adapter.displayName,
              profile,
              providers: config.providers,
              mode,
              scope,
              cwd: launchCwd,
            });
            for (const line of describePreviewLines(preview)) {
              console.log(line);
            }
            for (const warning of preview.warnings) {
              console.warn(`Warning: ${warning}`);
            }
            process.exit(0);
          }

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
              console.error(`Error: failed to start "${execReq.command}": ${result.error.message}`);
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
