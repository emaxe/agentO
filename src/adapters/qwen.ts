import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../config/atomic-write.js';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';

export interface QwenModelProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  generationConfig: {
    modalities: { image: boolean; video: boolean; audio: boolean };
  };
}

export interface QwenConfig {
  env?: Record<string, string>;
  modelProviders?: Record<string, QwenModelProviderEntry[]>;
  security?: { auth: { selectedType: string } };
  model?: { name: string };
  $version?: number;
  [key: string]: unknown;
}


/** Генерирует env-ключ для Qwen из baseUrl.
 * Пример: "http://188.132.197.214:20128/v1" → "QWEN_CUSTOM_API_KEY_OPENAI_HTTP_188_132_197_214_20128_V1"
 */
function deriveEnvKey(baseUrl: string): string {
  const normalized = baseUrl
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `QWEN_CUSTOM_API_KEY_OPENAI_${normalized}`;
}

export class QwenAdapter implements AgentAdapter<QwenConfig> {
  readonly id = 'qwen';
  readonly displayName = 'Qwen CLI';
  readonly supportedProviderTypes = ['openai-compatible', 'fireworks', 'openrouter', 'custom-api'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.qwen', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.qwen', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<QwenConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as QwenConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): QwenConfig {
    if (profile.models.length === 0) {
      throw new Error(`Profile "${profile.name}" has no models`);
    }

    // Определяем активную модель (base tier или первая)
    const baseModel = profile.models.find((m) => m.tier === 'base') ?? profile.models[0]!;

    // Строим список всех моделей, группируем по провайдеру
    const envMap: Record<string, string> = {};
    const modelProviders: Record<string, QwenModelProviderEntry[]> = {};

    for (const profileModel of profile.models) {
      const provider = providers.find((p) => p.id === profileModel.providerId);
      if (!provider) {
        throw new Error(`Provider not found for id: ${profileModel.providerId}`);
      }
      if (provider.type === 'anthropic-compatible') {
        throw new Error(`Qwen CLI does not support Anthropic providers (provider: "${provider.name}")`);
      }
      let resolvedBaseUrl: string | undefined;
      if (provider.type === 'custom-api') {
        if (!provider.customApiModes?.openai) {
          throw new Error(`Qwen CLI requires openai mode for custom-api provider "${provider.name}"`);
        }
        resolvedBaseUrl = resolveCustomApiUrl(provider, 'openai');
      } else {
        resolvedBaseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type];
      }
      if (!resolvedBaseUrl) {
        throw new Error(`Qwen CLI requires a baseUrl for provider "${provider.name}"`);
      }

      const providerKey = 'openai';
      const envKey = deriveEnvKey(resolvedBaseUrl);
      envMap[envKey] = provider.apiKey;

      const modelConfig = provider.models.find((m) => m.name === profileModel.model);
      const caps = modelConfig?.capabilities ?? { image: true, video: false, audio: false };

      if (!modelProviders[providerKey]) modelProviders[providerKey] = [];
      modelProviders[providerKey].push({
        id: profileModel.model,
        name: profileModel.model,
        baseUrl: resolvedBaseUrl,
        envKey,
        generationConfig: {
          modalities: { image: caps.image, video: caps.video, audio: caps.audio },
        },
      });
    }

    return {
      env: envMap,
      modelProviders,
      security: {
        auth: { selectedType: 'openai' },
      },
      model: { name: baseModel.model },
      $version: 4,
    };
  }

  /**
   * Writes the agent config to disk.
   *
   * When `mergeEnabled` is true, reads the existing config and performs a
   * conservative shallow merge: unknown top-level keys are preserved, generated
   * keys overwrite, nested objects are replaced whole, and `env` is merged flat.
   */
  async writeConfig(config: QwenConfig, scope: LaunchScope, cwd?: string, mergeEnabled?: boolean): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    if (mergeEnabled) {
      const existing = await this.readConfig(scope, cwd);
      if (existing) {
        config = mergeAgentConfig(existing, config, ['env']);
      }
    }
    await writeJsonAtomic(path, config);
  }
}

export const qwenAdapter = new QwenAdapter();
