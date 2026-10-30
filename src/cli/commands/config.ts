/**
 * CLI command: `agento config`
 *
 * `path` prints the files AgentO reads and writes. Useful in scripts and when
 * reporting a problem without hunting through the home directory.
 */
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function createConfigCommand(): Command {
  const cmd = new Command('config').description('Inspect AgentO configuration paths');

  cmd
    .command('path')
    .description('Print config, UI state and backup paths')
    .option('--json', 'Output JSON')
    .action((opts: { json?: boolean }) => {
      const dir = join(homedir(), '.agento');
      const paths = {
        config: join(dir, 'config.json'),
        uiState: join(dir, 'ui-state.json'),
        backups: join(dir, 'backups'),
      };
      if (opts.json) {
        console.log(JSON.stringify(paths, null, 2));
      } else {
        console.log(`config:  ${paths.config}`);
        console.log(`uiState: ${paths.uiState}`);
        console.log(`backups: ${paths.backups}`);
      }
      process.exitCode = 0;
    });

  return cmd;
}
