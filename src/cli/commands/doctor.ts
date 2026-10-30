/**
 * CLI command: `agento doctor`
 *
 * One screen with the facts needed to triage a setup problem: versions, config
 * readability and location, active backups, and which agents are installed.
 * Read-only — it never fixes anything.
 */
import { Command } from 'commander';
import { access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../../config/store.js';
import { readUiState } from '../../config/ui-state.js';
import { VERSION } from '../../config/version.js';
import { backupExists } from '../../config/store.js';
import { getAgentInstaller, listAgents } from '../../agents/registry.js';

interface DoctorReport {
  version: string;
  node: string;
  platform: string;
  arch: string;
  configDir: string;
  configDirExists: boolean;
  configWritable: boolean;
  configPath: string;
  uiStatePath: string;
  configOk: boolean;
  configError?: string;
  providers: number;
  profiles: number;
  lastLaunch?: string;
  activeBackups: Array<{ agentId: string; scope: string }>;
  installedAgents: Array<{ id: string; installed: boolean; version?: string }>;
}

async function collect(): Promise<DoctorReport> {
  const configDir = join(homedir(), '.agento');
  const configPath = join(configDir, 'config.json');
  const uiStatePath = join(configDir, 'ui-state.json');

  let configOk = true;
  let configError: string | undefined;
  let providers = 0;
  let profiles = 0;
  try {
    const config = await readConfig();
    providers = config.providers.length;
    profiles = config.profiles.length;
  } catch (err) {
    configOk = false;
    configError = err instanceof Error ? err.message : String(err);
  }

  const ui = await readUiState();
  const last = ui.lastLaunch;

  const cwd = process.cwd();
  const activeBackups: Array<{ agentId: string; scope: string }> = [];
  for (const agent of listAgents({ dev: true })) {
    for (const scope of ['global', 'project'] as const) {
      if (backupExists(agent.id, scope, cwd)) {
        activeBackups.push({ agentId: agent.id, scope });
      }
    }
  }

  const installedAgents = await Promise.all(
    listAgents({ dev: true }).map(async (agent) => {
      const installer = getAgentInstaller(agent.id, { dev: true });
      if (!installer) return { id: agent.id, installed: false };
      try {
        const result = await installer.checkInstalled();
        return {
          id: agent.id,
          installed: result.installed,
          ...(result.version ? { version: result.version } : {}),
        };
      } catch {
        return { id: agent.id, installed: false };
      }
    }),
  );

  let configWritable = false;
  try {
    await access(configDir, constants.W_OK);
    configWritable = true;
  } catch {
    configWritable = false;
  }

  return {
    version: VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    configDir,
    configDirExists: existsSync(configDir),
    configWritable,
    configPath,
    uiStatePath,
    configOk,
    ...(configError ? { configError } : {}),
    providers,
    profiles,
    ...(last
      ? { lastLaunch: `${last.profileId} → ${last.agentId} (${last.mode}, ${last.scope})` }
      : {}),
    activeBackups,
    installedAgents,
  };
}

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Print diagnostics for AgentO and installed agents')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const report = await collect();
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(
            `AgentO ${report.version} (Node ${report.node}, ${report.platform} ${report.arch})`,
          );
          console.log(
            `  config dir: ${report.configDir} (${report.configDirExists ? 'exists' : 'missing'}, ${report.configWritable ? 'writable' : 'not writable'})`,
          );
          console.log(`  config:     ${report.configPath}`);
          console.log(`  ui state:   ${report.uiStatePath}`);
          console.log(`  config ok:  ${report.configOk ? 'yes' : `no — ${report.configError}`}`);
          console.log(`  providers:  ${report.providers}`);
          console.log(`  profiles:   ${report.profiles}`);
          if (report.lastLaunch) console.log(`  last launch: ${report.lastLaunch}`);
          console.log(
            `  active backups (cwd): ${
              report.activeBackups.length > 0
                ? report.activeBackups.map((entry) => `${entry.agentId}[${entry.scope}]`).join(', ')
                : 'none'
            }`,
          );
          const installed = report.installedAgents
            .filter((agent) => agent.installed)
            .map((agent) => `${agent.id}${agent.version ? ` v${agent.version}` : ''}`);
          console.log(
            `  installed agents: ${installed.length > 0 ? installed.join(', ') : 'none detected'}`,
          );
        }
        process.exitCode = report.configOk ? 0 : 1;
        return;
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
