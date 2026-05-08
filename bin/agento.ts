#!/usr/bin/env node
import { program } from 'commander';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('agento')
  .description('Manage AI agent configurations with profiles and providers')
  .version(pkg.version);

// Subcommands (stubs — реализация в src/cli/commands/)
program
  .command('launch')
  .description('Launch an agent with a profile')
  .allowUnknownOption()
  .action(() => {
    console.log('CLI command: launch');
  });

program
  .command('provider')
  .description('Manage providers')
  .allowUnknownOption()
  .action(() => {
    console.log('CLI command: provider');
  });

program
  .command('profile')
  .description('Manage profiles')
  .allowUnknownOption()
  .action(() => {
    console.log('CLI command: profile');
  });

program
  .command('restore')
  .description('Restore agent config from backup')
  .allowUnknownOption()
  .action(() => {
    console.log('CLI command: restore');
  });

program
  .command('agent')
  .description('Agent config status')
  .allowUnknownOption()
  .action(() => {
    console.log('CLI command: agent');
  });

// Default action: launch TUI
program.action(() => {
  console.log('Starting TUI...');
  // TODO: запустить TUI (src/tui/App.tsx)
});

program.parse(process.argv);
