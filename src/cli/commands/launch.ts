import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import { qwenAdapter } from '../../adapters/qwen.js';
import { codexAdapter } from '../../adapters/codex.js';
import { launchChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import type { AgentAdapter } from '../../adapters/base.js';
import type { ProviderType } from '../../config/schema.js';

const ALL_AGENT_COMMANDS: Record<string, { adapter: AgentAdapter; command: string; args?: string[] }> = {
  'claude-code': { adapter: claudeCodeAdapter, command: 'claude' },
  'opencode': { adapter: openCodeAdapter, command: 'opencode' },
  'qwen': { adapter: qwenAdapter, command: 'qwen' },
  'codex': { adapter: codexAdapter, command: 'codex', args: ['-p', 'default'] },
};

function getAgentCommands(dev = false): Record<string, { adapter: AgentAdapter; command: string; args?: string[] }> {
  if (dev) return ALL_AGENT_COMMANDS;
  return Object.fromEntries(
    Object.entries(ALL_AGENT_COMMANDS).filter(([, entry]) => !entry.adapter.dev),
  );
}

export function createLaunchCommand(): Command {
  const cmd = new Command('launch')
    .description('Launch an agent with a profile')
    .requiredOption('-p, --profile <name>', 'Profile name to use')
    .requiredOption('-a, --agent <id>', 'Agent to launch (claude-code, opencode, qwen, codex)')
    .option('-m, --mode <mode>', 'Launch mode: child or independent')
    .option('-s, --scope <scope>', 'Config scope: global or project')
    .option('-d, --dev', 'Show development agents (e.g. codex)')
    .action(async (opts: { profile: string; agent: string; mode?: string; scope?: string; dev?: boolean }) => {
      const AGENT_COMMANDS = getAgentCommands(opts.dev);
      try {
        const config = await readConfig();

        // Resolve profile
        const profile = config.profiles.find(
          (p) => p.name === opts.profile || p.id === opts.profile,
        );
        if (!profile) {
          console.error(`Error: Profile not found: ${opts.profile}`);
          process.exit(1);
        }

        // Resolve agent
        const agentEntry = AGENT_COMMANDS[opts.agent];
        if (!agentEntry) {
          console.error(`Error: Unknown agent: ${opts.agent}. Supported: ${Object.keys(AGENT_COMMANDS).join(', ')}`);
          process.exit(1);
        }

        // Resolve mode and scope (fallback to settings)
        const mode = (opts.mode ?? config.settings.defaultLaunchMode) as 'child' | 'independent';
        const scope = (opts.scope ?? config.settings.defaultConfigScope) as 'global' | 'project';

        const { adapter, command, args } = agentEntry;

        // Check provider compatibility
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

        if (mode === 'child') {
          const exitCode = await launchChild({
            adapter,
            profile,
            providers: config.providers,
            scope,
            command,
            args,
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
