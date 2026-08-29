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
  Promise.all([import('../src/tui/start.js'), import('../src/tui/run-loop.js')])
    .then(([{ startTui }, { runTuiLoop }]) =>
      runTuiLoop(
        {
          startTui,
          spawnAgent: spawnAsync,
          // Ink may leave stdin in "flowing" state — pause before handing fd to child
          beforeSpawn: () => process.stdin.pause(),
        },
        { dev: opts.dev },
      ),
    )
    .catch(console.error);
});

program.parse(process.argv);
