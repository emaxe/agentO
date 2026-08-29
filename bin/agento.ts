#!/usr/bin/env node
/**
 * Entry point for the `agento` CLI tool.
 *
 * Registers all subcommands (launch, provider, profile, restore, agent)
 * and defaults to launching the interactive Terminal UI (TUI) when no
 * subcommand is provided.
 */
import { program } from 'commander';
import { createRequire } from 'module';
import { spawn } from 'node:child_process';
import { createLaunchCommand } from '../src/cli/commands/launch.js';
import { createProviderCommand } from '../src/cli/commands/provider.js';
import { createProfileCommand } from '../src/cli/commands/profile.js';
import { createRestoreCommand } from '../src/cli/commands/restore.js';
import { createAgentCommand } from '../src/cli/commands/agent.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('agento')
  .description('Manage AI agent configurations with profiles and providers')
  .version(pkg.version)
  .option('-d, --dev', 'Show development agents (e.g. codex)');

// Register CLI subcommands
program.addCommand(createLaunchCommand());
program.addCommand(createProviderCommand());
program.addCommand(createProfileCommand());
program.addCommand(createRestoreCommand());
program.addCommand(createAgentCommand());

/** Returns true if error looks like ENOENT from spawn/spawnSync. */
function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'ENOENT';
}

/** Spawn a child process asynchronously, returning its exit code. */
function spawnAsync(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(null);
      } else {
        resolve(code ?? 0);
      }
    });
  });
}

// Default action: launch interactive TUI
program.action(() => {
  const opts = program.opts() as { dev?: boolean };
  import('../src/tui/start.js')
    .then(async ({ startTui }) => {
      let execReq = await startTui({ dev: opts.dev });
      while (execReq) {
        // Ink may leave stdin in "flowing" state — pause before handing fd to child
        process.stdin.pause();
        // Printed here rather than inside the TUI: writing to stdout while Ink
        // renders would corrupt the frame.
        for (const warning of execReq.warnings ?? []) {
          console.warn(`Warning: ${warning}`);
        }
        try {
          await spawnAsync(execReq.command, execReq.args, execReq.env);
        } catch (err) {
          if (isEnoent(err)) {
            await execReq.cleanup?.();
            execReq = await startTui({
              dev: opts.dev,
              launchError: {
                agentId: execReq.agentId ?? execReq.command,
                profileId: execReq.profileId,
                error: `Command "${execReq.command}" not found`,
              },
            });
            continue;
          }
          throw err;
        }
        await execReq.cleanup?.();
        if (!execReq.relaunch) break;
        execReq = await startTui({ dev: opts.dev });
      }
    })
    .catch(console.error);
});

program.parse(process.argv);
