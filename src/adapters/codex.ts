import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';
import type { BackupManifestFile, WriteBackupFile } from '../config/store.js';

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

function missingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
}

async function readTomlFile(path: string): Promise<AgentConfig | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  return parseToml(raw) as AgentConfig;
}

async function writeTomlFile(path: string, config: AgentConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), 'utf-8');
}

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
    return readTomlFile(path);
  }

  async snapshotConfigFiles(scope: LaunchScope, cwd?: string): Promise<WriteBackupFile[]> {
    const paths = this.configPaths(cwd);
    const filePaths = scope === 'project'
      ? [paths.global, paths.project]
      : [paths[scope]];

    return Promise.all(filePaths.map(async (path) => {
      const content = await readTomlFile(path);
      return {
        path,
        format: 'toml' as const,
        hadFile: content !== null,
        content,
      };
    }));
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
      const hasGlobalOwnedConfig = ['model_providers', 'default_profile', 'profiles']
        .some((key) => config[key] !== undefined);

      if (hasGlobalOwnedConfig) {
        const globalConfig = await readTomlFile(paths.global) ?? {};
        if (config.model_providers !== undefined) {
          globalConfig.model_providers = config.model_providers;
        }
        if (config.default_profile !== undefined) {
          globalConfig.default_profile = config.default_profile;
        }
        if (config.profiles !== undefined) {
          globalConfig.profiles = config.profiles;
        }
        await writeTomlFile(paths.global, globalConfig);
      }

      // 2. Управляем project конфигом (model)
      const projectPath = paths.project;
      const projectConfig: AgentConfig = {};
      if (config.model) {
        projectConfig.model = config.model;
      }
      await writeTomlFile(projectPath, projectConfig);
    } else {
      // scope === 'global' — пишем всё в global config как раньше
      const path = this.configPaths(cwd)[scope];
      await writeTomlFile(path, config);
    }
  }

  async restoreConfigFile(file: BackupManifestFile, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = file.path || this.configPaths(cwd)[scope];
    if (file.hadFile) {
      await writeTomlFile(path, file.content as AgentConfig);
      return;
    }

    await removeIfExists(path);
  }
}

export const codexAdapter = new CodexAdapter();
