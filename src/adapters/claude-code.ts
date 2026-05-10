import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { ModelTier, Profile, ProfileModel, Provider } from '../config/schema.js';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference';

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

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly supportedProviderTypes = ['anthropic', 'fireworks'] as const;

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
    const anthropicBase =
      baseProvider.baseUrl ?? (baseProvider.type === 'fireworks' ? FIREWORKS_BASE_URL : undefined);
    if (anthropicBase) {
      env['ANTHROPIC_BASE_URL'] = anthropicBase;
    }

    const config: AgentConfig = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      apiKeyHelper: `bash -c 'echo ${escapeForSingleQuoted(baseProvider.apiKey)}'`,
      env,
      model: base.model,
    };

    return config;
  }

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
