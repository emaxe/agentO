import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.claude', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.claude', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): AgentConfig {
    const first = profile.models[0];
    if (!first) throw new Error(`Profile "${profile.name}" has no models`);

    const provider = providers.find((p) => p.id === first.providerId);
    if (!provider) throw new Error(`Provider not found for id: ${first.providerId}`);

    const env: Record<string, string> = {
      ANTHROPIC_API_KEY: provider.apiKey,
      ANTHROPIC_MODEL: first.model,
    };
    if (provider.baseUrl) {
      env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
    }

    return { env };
  }

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
