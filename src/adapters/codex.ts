import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';

const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Нормализует имя провайдера в ключ: "Fireworks AI" → "fireworks-ai" */
function deriveProviderKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** Генерирует имя env-переменной для ключа API: "fireworks-ai" → "CODEX_FIREWORKS_AI_API_KEY" */
function deriveEnvKey(providerKey: string): string {
  return `CODEX_${providerKey.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/** Backup глобального конфига Codex при записи в project scope */
let codexGlobalBackup: { hadConfig: boolean; config: AgentConfig } | null = null;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly dev = true;
  readonly supportedProviderTypes = ['fireworks', 'openrouter'] as const;

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
          base_url: provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type] ?? '',
          env_key: envKey,
          wire_api: 'responses',
        },
      },
      default_profile: 'default',
      profiles: {
        default: {
          model: base.model,
          model_provider: providerKey,
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
    if (scope === 'project') {
      const paths = this.configPaths(cwd);
      const hasModelProviders =
        config.model_providers !== undefined &&
        Object.keys(config.model_providers as Record<string, unknown>).length > 0;

      // 1. Управляем глобальным конфигом (model_providers всегда в global)
      if (hasModelProviders) {
        // Новый конфиг — backup глобального конфига перед патчем
        const globalPath = paths.global;
        if (codexGlobalBackup === null) {
          if (existsSync(globalPath)) {
            const raw = await readFile(globalPath, 'utf-8');
            codexGlobalBackup = { hadConfig: true, config: parseToml(raw) as AgentConfig };
          } else {
            codexGlobalBackup = { hadConfig: false, config: {} };
          }
        }

        let globalConfig: AgentConfig = {};
        if (existsSync(globalPath)) {
          const raw = await readFile(globalPath, 'utf-8');
          globalConfig = parseToml(raw) as AgentConfig;
        }
        globalConfig.model_providers = config.model_providers;
        globalConfig.default_profile = config.default_profile;
        globalConfig.profiles = config.profiles;
        await mkdir(dirname(globalPath), { recursive: true });
        await writeFile(
          globalPath,
          stringifyToml(globalConfig as Parameters<typeof stringifyToml>[0]),
          'utf-8',
        );
      } else if (codexGlobalBackup) {
        // Restore — восстанавливаем глобальный конфиг
        const globalPath = paths.global;
        if (codexGlobalBackup.hadConfig) {
          await mkdir(dirname(globalPath), { recursive: true });
          await writeFile(
            globalPath,
            stringifyToml(codexGlobalBackup.config as Parameters<typeof stringifyToml>[0]),
            'utf-8',
          );
        } else {
          // Глобального конфига не было — убираем наши ключи из существующего
          if (existsSync(globalPath)) {
            const raw = await readFile(globalPath, 'utf-8');
            const globalConfig = parseToml(raw) as AgentConfig;
            delete globalConfig.model_providers;
            delete globalConfig.default_profile;
            delete globalConfig.profiles;
            const remainingKeys = Object.keys(globalConfig);
            if (remainingKeys.length === 0) {
              // Файл пустой после удаления — удаляем его
              const { unlink } = await import('node:fs/promises');
              await unlink(globalPath);
            } else {
              await writeFile(
                globalPath,
                stringifyToml(globalConfig as Parameters<typeof stringifyToml>[0]),
                'utf-8',
              );
            }
          }
        }
        codexGlobalBackup = null;
      }

      // 2. Управляем project конфигом (model)
      const projectPath = paths.project;
      const projectConfig: AgentConfig = {};
      if (config.model) {
        projectConfig.model = config.model;
      }
      await mkdir(dirname(projectPath), { recursive: true });
      await writeFile(
        projectPath,
        stringifyToml(projectConfig as Parameters<typeof stringifyToml>[0]),
        'utf-8',
      );
    } else {
      // scope === 'global' — пишем всё в global config как раньше
      const path = this.configPaths(cwd)[scope];
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), 'utf-8');
    }
  }
}

export const codexAdapter = new CodexAdapter();
