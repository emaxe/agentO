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
import { createLaunchCommand } from '../src/cli/commands/launch.js';
import { createProviderCommand } from '../src/cli/commands/provider.js';
import { createProfileCommand } from '../src/cli/commands/profile.js';
import { createRestoreCommand } from '../src/cli/commands/restore.js';
import { createAgentCommand } from '../src/cli/commands/agent.js';
import { forwardSignals } from '../src/launcher/signal-forwarding.js';
import { spawnCommand } from '../src/platform/spawn.js';

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

/** Set once a signal made agento terminate the agent; the TUI loop must not reopen after that. */
let terminatedBySignal = false;

/**
 * Spawn a child process asynchronously, returning its exit code.
 *
 * Signals are handled for the agent's lifetime: with no handler, Ctrl+C or
 * SIGTERM ended agento before `run-loop` could restore the patched agent config.
 */
function spawnAsync(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawnCommand(command, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env,
    });
    const forwarding = forwardSignals(child);

    child.on('error', (err) => {
      forwarding.dispose();
      reject(err);
    });

    child.on('exit', (code, signal) => {
      forwarding.dispose();
      if (forwarding.wasSignalled()) terminatedBySignal = true;
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'agento: the interactive TUI needs a terminal. Use `agento launch -p <profile> -a <agent>`.',
    );
    process.exit(2);
  }
  const opts = program.opts() as { dev?: boolean };
  Promise.all([import('../src/tui/start.js'), import('../src/tui/run-loop.js')])
    .then(([{ startTui }, { runTuiLoop }]) =>
      runTuiLoop(
        {
          startTui,
          spawnAgent: spawnAsync,
          // Ink may leave stdin in "flowing" state — pause before handing fd to child.
          // On Windows also drop raw mode first (Ink is already unmounted), otherwise the
          // child's first keystroke can be swallowed by the console input mode left behind.
          beforeSpawn: () => {
            if (process.platform === 'win32') process.stdin.setRawMode?.(false);
            process.stdin.pause();
          },
          shouldStop: () => terminatedBySignal,
        },
        { dev: opts.dev },
      ),
    )
    .then(() => {
      if (terminatedBySignal) process.exitCode = 1;
    })
    .catch(console.error);
});

program.parse(process.argv);
