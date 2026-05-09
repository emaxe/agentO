import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'opencode', 'config.json'),
      project: join(cwd ?? process.cwd(), 'opencode.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): AgentConfig {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) throw new Error(`Profile "${profile.name}" has no models`);

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) throw new Error(`Provider not found for id: ${base.providerId}`);

    if (provider.type === 'anthropic') {
      const options: Record<string, unknown> = { apiKey: provider.apiKey };
      if (provider.baseUrl) options['baseURL'] = provider.baseUrl;
      return {
        model: `anthropic/${base.model}`,
        provider: { anthropic: { options } },
      };
    }

    // openai-compatible: кастомный провайдер с именем из agento
    const providerKey = provider.name.toLowerCase().replace(/\s+/g, '-');
    const options: Record<string, unknown> = { apiKey: provider.apiKey };
    if (provider.baseUrl) options['baseURL'] = provider.baseUrl;
    return {
      model: `${providerKey}/${base.model}`,
      provider: {
        [providerKey]: {
          npm: '@ai-sdk/openai-compatible',
          name: provider.name,
          options,
          models: { [base.model]: { name: base.model } },
        },
      },
    };
  }

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export const openCodeAdapter = new OpenCodeAdapter();
