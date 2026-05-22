import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../config/atomic-write.js';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { ModelTier, Profile, ProfileModel, Provider } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';
import { DEFAULT_ANTHROPIC_BASE_URLS } from '../config/defaults.js';

export interface ClaudeCodeConfig {
  $schema?: string;
  env?: Record<string, string>;
  model?: string;
  apiKeyHelper?: string;
  [key: string]: unknown;
}

function escapeForSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function pickByTier(
  models: ProfileModel[],
  tier: ModelTier,
  fallback: ProfileModel,
): ProfileModel {
  return models.find((m) => m.tier === tier) ?? fallback;
}

export class ClaudeCodeAdapter implements AgentAdapter<ClaudeCodeConfig> {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly supportedProviderTypes = ['anthropic-compatible', 'fireworks', 'openrouter', 'custom-api', 'openai-compatible', 'responses-compatible'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.claude', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.claude', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<ClaudeCodeConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as ClaudeCodeConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): ClaudeCodeConfig {
    const first = profile.models[0];
    if (!first) throw new Error(`Profile "${profile.name}" has no models`);

    // Базовая модель: явный tier=base, иначе первая в списке.
    const base =
      profile.models.find((m) => m.tier === 'base') ?? first;

    const baseProvider = providers.find((p) => p.id === base.providerId);
    if (!baseProvider) throw new Error(`Provider not found for id: ${base.providerId}`);

    // Если в профиле одна модель — она применяется ко всем уровням.
    const small = pickByTier(profile.models, 'small', base);
    const smart = pickByTier(profile.models, 'smart', base);

    // Claude Code supports only one provider per profile
    const providerIds = new Set([small.providerId, base.providerId, smart.providerId]);
    if (providerIds.size > 1) {
      throw new Error(
        `Claude Code supports only one provider per profile. Found providers for different tiers: ${[...providerIds].join(', ')}`
      );
    }

    const env: Record<string, string> = {
      ANTHROPIC_MODEL: base.model,
      ANTHROPIC_SMALL_FAST_MODEL: small.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: small.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: base.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: smart.model,
    };
    let anthropicBase: string | undefined;
    if (baseProvider.type === 'custom-api') {
      if (baseProvider.customApiModes?.anthropic) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'anthropic');
      } else if (baseProvider.customApiModes?.openai) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'openai');
      } else if (baseProvider.customApiModes?.responses) {
        // Responses mode: proxy will rewrite /v1/messages → /v1/responses at runtime
        anthropicBase = baseProvider.baseUrl;
      } else {
        throw new Error(`Claude Code requires anthropic, openai, or responses mode for custom-api provider "${baseProvider.name}"`);
      }
    } else if (baseProvider.type === 'responses-compatible') {
      // Responses-compatible provider: proxy intercepts at URL level
      anthropicBase = baseProvider.baseUrl;
    } else {
      anthropicBase = baseProvider.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URLS[baseProvider.type];
    }
    if (anthropicBase) {
      env['ANTHROPIC_BASE_URL'] = anthropicBase;
    }

    // OpenRouter Anthropic Skin принимает Bearer-токен (ANTHROPIC_AUTH_TOKEN),
    // а не x-api-key (apiKeyHelper). ANTHROPIC_API_KEY должен быть пустым,
    // иначе Claude Code fallback'нется на нативный Anthropic endpoint.
    if (baseProvider.type === 'openrouter') {
      env['ANTHROPIC_AUTH_TOKEN'] = baseProvider.apiKey;
      env['ANTHROPIC_API_KEY'] = '';
      return {
        $schema: 'https://json.schemastore.org/claude-code-settings.json',
        env,
        model: base.model,
      };
    }

    const config: ClaudeCodeConfig = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      apiKeyHelper: `bash -c 'echo ${escapeForSingleQuoted(baseProvider.apiKey)}'`,
      env,
      model: base.model,
    };

    return config;
  }

  /**
   * Writes the agent config to disk.
   *
   * When `mergeEnabled` is true, reads the existing config and performs a
   * conservative shallow merge: unknown top-level keys are preserved, generated
   * keys overwrite, nested objects are replaced whole, and `env` is merged flat.
   */
  async writeConfig(config: ClaudeCodeConfig, scope: LaunchScope, cwd?: string, mergeEnabled?: boolean): Promise<void> {
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

export const claudeCodeAdapter = new ClaudeCodeAdapter();
