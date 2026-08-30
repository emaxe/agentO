import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';
import { resolveBaseModel } from './resolve-base-model.js';

export interface CopilotConfig {
  [key: string]: unknown;
}

/** Map AgentO provider types to Copilot CLI COPILOT_PROVIDER_TYPE values. */
const PROVIDER_TYPE_MAP: Record<ProviderType, string> = {
  'openai-compatible': 'openai',
  'anthropic-compatible': 'anthropic',
  fireworks: 'openai',
  openrouter: 'openai',
  'responses-compatible': 'openai',
  'custom-api': 'openai',
};

export class CopilotAdapter implements AgentAdapter<CopilotConfig> {
  readonly id = 'copilot';
  readonly displayName = 'Copilot CLI';
  readonly supportedProviderTypes = [
    'openai-compatible',
    'anthropic-compatible',
    'fireworks',
    'openrouter',
    'responses-compatible',
    'custom-api',
  ] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.copilot', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.copilot', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<CopilotConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as CopilotConfig;
  }

  buildConfig(_profile: Profile, _providers: Provider[]): CopilotConfig {
    // Copilot CLI accepts model via COPILOT_MODEL env var (handled by buildEnv),
    // so we do not need to mutate the settings file.
    return {};
  }

  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const { model: base, provider } = resolveBaseModel(profile, providers);

    let copilotProviderType: string;
    let resolvedUrl: string | undefined;

    if (provider.type === 'custom-api') {
      if (provider.customApiModes?.anthropic) {
        copilotProviderType = 'anthropic';
        resolvedUrl = resolveCustomApiUrl(provider, 'anthropic');
      } else if (provider.customApiModes?.openai || provider.customApiModes?.responses) {
        copilotProviderType = 'openai';
        resolvedUrl =
          resolveCustomApiUrl(provider, 'openai') ?? resolveCustomApiUrl(provider, 'responses');
      } else {
        throw new Error(
          `Copilot CLI: custom-api provider "${provider.name}" requires at least one compatible mode (anthropic, openai, or responses)`,
        );
      }
    } else {
      copilotProviderType = PROVIDER_TYPE_MAP[provider.type];
      const defaultUrl = DEFAULT_BASE_URLS[provider.type];
      if (!provider.baseUrl && provider.type === 'responses-compatible') {
        throw new Error(`baseUrl required for ${provider.type} provider in Copilot CLI`);
      }
      resolvedUrl = provider.baseUrl ?? defaultUrl;
    }

    if (!resolvedUrl) {
      throw new Error(`No base URL configured for provider type "${provider.type}" in Copilot CLI`);
    }

    const env: Record<string, string> = {
      COPILOT_MODEL: base.model,
      COPILOT_PROVIDER_TYPE: copilotProviderType,
      COPILOT_PROVIDER_API_KEY: provider.apiKey,
      COPILOT_PROVIDER_BASE_URL: resolvedUrl,
    };

    if (
      provider.type === 'responses-compatible' ||
      (provider.type === 'custom-api' && provider.customApiModes?.responses)
    ) {
      env.COPILOT_PROVIDER_WIRE_API = 'responses';
    }

    return env;
  }

  async writeConfig(
    _config: CopilotConfig,
    _scope: LaunchScope,
    _cwd?: string,
    _mergeEnabled?: boolean,
  ): Promise<void> {
    // No-op: Copilot CLI receives all config via environment variables (see buildEnv).
    // There is nothing to write to settings.json.
  }
}

export const copilotAdapter = new CopilotAdapter();
