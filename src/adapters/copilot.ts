import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';

const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  anthropic: 'https://api.anthropic.com',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Map AgentO provider types to Copilot CLI COPILOT_PROVIDER_TYPE values. */
const PROVIDER_TYPE_MAP: Record<ProviderType, string> = {
  'openai-compatible': 'openai',
  'anthropic': 'anthropic',
  'fireworks': 'openai',
  'openrouter': 'openai',
};

export class CopilotAdapter implements AgentAdapter {
  readonly id = 'copilot';
  readonly displayName = 'Copilot CLI';
  readonly supportedProviderTypes = ['openai-compatible', 'anthropic', 'fireworks', 'openrouter'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.copilot', 'settings.json'),
      project: join(cwd ?? process.cwd(), '.copilot', 'settings.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  }

  buildConfig(_profile: Profile, _providers: Provider[]): AgentConfig {
    // Copilot CLI accepts model via COPILOT_MODEL env var (handled by buildEnv),
    // so we do not need to mutate the settings file.
    return {};
  }

  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) return {};

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) return {};

    const env: Record<string, string> = {
      COPILOT_MODEL: base.model,
      COPILOT_PROVIDER_TYPE: PROVIDER_TYPE_MAP[provider.type],
      COPILOT_PROVIDER_API_KEY: provider.apiKey,
    };

    const defaultUrl = DEFAULT_BASE_URLS[provider.type];
    if (!provider.baseUrl && provider.type === 'openai-compatible') {
      throw new Error('baseUrl required for openai-compatible provider in Copilot CLI');
    }
    const resolvedUrl = provider.baseUrl ?? defaultUrl;
    if (!resolvedUrl) {
      throw new Error(`No base URL configured for provider type "${provider.type}" in Copilot CLI`);
    }
    env.COPILOT_PROVIDER_BASE_URL = resolvedUrl;

    if (base.model.startsWith('gpt-5')) {
      env.COPILOT_PROVIDER_WIRE_API = 'responses';
    }

    return env;
  }

  async writeConfig(_config: AgentConfig, _scope: LaunchScope, _cwd?: string): Promise<void> {
    // No-op: Copilot CLI receives all config via environment variables (see buildEnv).
    // There is nothing to write to settings.json.
  }
}

export const copilotAdapter = new CopilotAdapter();
