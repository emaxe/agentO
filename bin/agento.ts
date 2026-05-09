#!/usr/bin/env node
import { program } from 'commander';
import { createRequire } from 'module';
import { spawnSync } from 'node:child_process';
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
  .version(pkg.version);

program.addCommand(createLaunchCommand());
program.addCommand(createProviderCommand());
program.addCommand(createProfileCommand());
program.addCommand(createRestoreCommand());
program.addCommand(createAgentCommand());

// Default action: launch TUI
program.action(() => {
  import('../src/tui/start.js')
    .then(async ({ startTui }) => {
      let execReq = await startTui();
      while (execReq) {
        // Ink may leave stdin in "flowing" state — pause before handing fd to child
        process.stdin.pause();
        spawnSync(execReq.command, execReq.args, {
          stdio: 'inherit',
          env: execReq.env,
        });
        await execReq.cleanup?.();
        if (!execReq.relaunch) break;
        execReq = await startTui();
      }
    })
    .catch(console.error);
});

program.parse(process.argv);
