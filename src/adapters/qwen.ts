import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';

const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

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

export class QwenAdapter implements AgentAdapter {
  readonly id = 'qwen';
  readonly displayName = 'Qwen CLI';
  readonly supportedProviderTypes = ['openai-compatible', 'fireworks', 'openrouter'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.qwen', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.qwen', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): AgentConfig {
    if (profile.models.length === 0) {
      throw new Error(`Profile "${profile.name}" has no models`);
    }

    // Определяем активную модель (base tier или первая)
    const baseModel = profile.models.find((m) => m.tier === 'base') ?? profile.models[0]!;

    // Строим список всех моделей, группируем по провайдеру
    const envMap: Record<string, string> = {};
    const modelProviders: Record<string, Array<{
      id: string;
      name: string;
      baseUrl: string;
      envKey: string;
      generationConfig: { modalities: { image: boolean; video: boolean; audio: boolean } };
    }>> = {};

    for (const profileModel of profile.models) {
      const provider = providers.find((p) => p.id === profileModel.providerId);
      if (!provider) {
        throw new Error(`Provider not found for id: ${profileModel.providerId}`);
      }
      if (provider.type === 'anthropic') {
        throw new Error(`Qwen CLI does not support Anthropic providers (provider: "${provider.name}")`);
      }
      const resolvedBaseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type];
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

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export const qwenAdapter = new QwenAdapter();
