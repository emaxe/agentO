import { readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { writeFileAtomic } from '../config/atomic-write.js';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import type { BackupManifestFile, WriteBackupFile } from '../config/store.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';
import { resolveBaseModel } from './resolve-base-model.js';

export interface CodexModelProvider {
  name: string;
  base_url: string;
  env_key: string;
  wire_api: string;
}

export interface CodexProfile {
  model: string;
  model_provider: string;
}

export interface CodexConfig {
  model?: string;
  model_providers?: Record<string, CodexModelProvider>;
  default_profile?: string;
  profiles?: Record<string, CodexProfile>;
  [key: string]: unknown;
}

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

/** Возвращает путь к профиль-файлу Codex CLI: ~/.codex/<name>.config.toml */
function profileConfigPath(name: string): string {
  return join(process.env.HOME ?? homedir(), '.codex', `${name}.config.toml`);
}

async function readTomlFile(path: string): Promise<CodexConfig | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  return parseToml(raw) as CodexConfig;
}

async function writeTomlFile(path: string, config: CodexConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, stringifyToml(config));
}

export class CodexAdapter implements AgentAdapter<CodexConfig> {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly supportedProviderTypes = [
    'openai-compatible',
    'responses-compatible',
    'fireworks',
    'openrouter',
    'custom-api',
  ] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(process.env.HOME ?? homedir(), '.codex', 'config.toml'),
      project: join(cwd ?? process.cwd(), '.codex', 'config.toml'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<CodexConfig | null> {
    const path = this.configPaths(cwd)[scope];
    return readTomlFile(path);
  }

  async snapshotConfigFiles(scope: LaunchScope, cwd?: string): Promise<WriteBackupFile[]> {
    const paths = this.configPaths(cwd);
    const filePaths =
      scope === 'project'
        ? [paths.global, paths.project, profileConfigPath('default')]
        : [paths.global, profileConfigPath('default')];

    return Promise.all(
      filePaths.map(async (path) => {
        const content = await readTomlFile(path);
        return {
          path,
          format: 'toml' as const,
          hadFile: content !== null,
          content,
        };
      }),
    );
  }

  buildConfig(profile: Profile, providers: Provider[]): CodexConfig {
    const { model: base, provider } = resolveBaseModel(profile, providers);

    const providerKey = deriveProviderKey(provider.name);
    const envKey = deriveEnvKey(providerKey);

    let baseUrl: string;
    let wireApi: string;

    if (provider.type === 'custom-api') {
      if (provider.customApiModes?.responses) {
        wireApi = 'responses';
        const resolved = resolveCustomApiUrl(provider, 'responses');
        if (!resolved) {
          throw new Error(
            `Codex CLI requires a baseUrl for custom-api provider "${provider.name}"`,
          );
        }
        baseUrl = resolved;
      } else if (provider.customApiModes?.openai) {
        wireApi = 'responses';
        const resolved = resolveCustomApiUrl(provider, 'openai');
        if (!resolved) {
          throw new Error(
            `Codex CLI requires a baseUrl for custom-api provider "${provider.name}"`,
          );
        }
        baseUrl = resolved;
      } else {
        throw new Error(
          `Codex CLI: custom-api provider "${provider.name}" requires at least one compatible mode (openai or responses)`,
        );
      }
    } else {
      baseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type] ?? '';
      wireApi = 'responses';
    }

    return {
      model: base.model,
      model_providers: {
        [providerKey]: {
          name: provider.name,
          base_url: baseUrl,
          env_key: envKey,
          wire_api: wireApi,
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
    const { provider } = resolveBaseModel(profile, providers);

    const providerKey = deriveProviderKey(provider.name);
    const envKey = deriveEnvKey(providerKey);

    return { [envKey]: provider.apiKey };
  }

  async writeConfig(config: CodexConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    // Extract profile data for the separate profile file (new Codex CLI format)
    const defaultProfilePath = profileConfigPath('default');
    const profileConfig: CodexConfig = {};

    if (config.profiles?.default) {
      profileConfig.model = config.profiles.default.model;
      profileConfig.model_provider = config.profiles.default.model_provider;
    } else if (config.default_profile === 'default' && config.model) {
      // Fallback: derive model_provider from the single model_providers entry if available
      const providerKeys = config.model_providers ? Object.keys(config.model_providers) : [];
      profileConfig.model = config.model;
      profileConfig.model_provider = providerKeys.length === 1 ? providerKeys[0] : '';
    }

    // Write profile file if we have profile data
    if (profileConfig.model !== undefined) {
      await writeTomlFile(defaultProfilePath, profileConfig);
    }

    if (scope === 'project') {
      const paths = this.configPaths(cwd);

      // 1. Global config: only model_providers, never default_profile/profiles
      if (config.model_providers !== undefined) {
        const existingGlobal = (await readTomlFile(paths.global)) ?? {};
        const globalConfig: CodexConfig = {};
        // Copy everything from existing except legacy profile keys
        for (const key of Object.keys(existingGlobal)) {
          if (key !== 'default_profile' && key !== 'profiles') {
            globalConfig[key as keyof CodexConfig] = existingGlobal[key];
          }
        }
        globalConfig.model_providers = config.model_providers;
        await writeTomlFile(paths.global, globalConfig);
      }

      // 2. Project config (model only)
      const projectConfig: CodexConfig = {};
      if (config.model) {
        projectConfig.model = config.model;
      }
      await writeTomlFile(paths.project, projectConfig);
    } else {
      // scope === 'global'
      const path = this.configPaths(cwd)[scope];
      const globalConfig: CodexConfig = {};
      if (config.model) {
        globalConfig.model = config.model;
      }
      if (config.model_providers) {
        globalConfig.model_providers = config.model_providers;
      }
      await writeTomlFile(path, globalConfig);
    }
  }

  async restoreConfigFile(
    file: BackupManifestFile,
    scope: LaunchScope,
    cwd?: string,
  ): Promise<void> {
    const path = file.path || this.configPaths(cwd)[scope];
    if (file.hadFile) {
      await writeTomlFile(path, file.content as CodexConfig);
      return;
    }

    await removeIfExists(path);
  }
}

export const codexAdapter = new CodexAdapter();
