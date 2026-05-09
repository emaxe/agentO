import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';

/** Нормализует имя провайдера в ключ: "Fireworks AI" → "fireworks-ai" */
function deriveProviderKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** Генерирует имя env-переменной для ключа API: "fireworks-ai" → "CODEX_FIREWORKS_AI_API_KEY" */
function deriveEnvKey(providerKey: string): string {
  return `CODEX_${providerKey.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.codex', 'config.toml'),
      project: join(cwd ?? process.cwd(), '.codex', 'config.toml'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return parseToml(raw) as AgentConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): AgentConfig {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) throw new Error(`Profile "${profile.name}" has no models`);

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) throw new Error(`Provider not found for id: ${base.providerId}`);

    const providerKey = deriveProviderKey(provider.name);
    const envKey = deriveEnvKey(providerKey);

    return {
      model: base.model,
      model_providers: {
        [providerKey]: {
          name: provider.name,
          base_url: provider.baseUrl ?? '',
          env_key: envKey,
          wire_api: 'openai',
        },
      },
    };
  }

  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) return {};

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) return {};

    const providerKey = deriveProviderKey(provider.name);
    const envKey = deriveEnvKey(providerKey);

    return { [envKey]: provider.apiKey };
  }

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), 'utf-8');
  }
}

export const codexAdapter = new CodexAdapter();
