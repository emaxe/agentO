import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';
import { resolveBaseModel } from './resolve-base-model.js';

export interface GooseConfig {
  raw?: string;
  [key: string]: unknown;
}

/** Default OpenRouter host (without path). Goose's openrouter provider appends its own path.
 *  Only set OPENROUTER_HOST when the user configured a non-default endpoint.
 */
const OPENROUTER_DEFAULT_HOST = 'https://openrouter.ai';

/**
 * Converts a full API base URL (which may include a versioned path like `/v1`) into
 * a host-only value suitable for Goose's `OPENAI_HOST` variable.
 *
 * Goose constructs the final request URL as:
 *   `{OPENAI_HOST}/v1/chat/completions`
 *
 * If the caller stores `https://api.fireworks.ai/inference/v1` (AgentO convention),
 * passing it directly produces a double-versioned path `/v1/v1/chat/completions`.
 * Stripping the trailing `/v{n}` fixes this.
 */
function toGooseOpenAIHost(url: string): string {
  return url.replace(/\/v\d+\/?$/, '');
}

export class GooseAdapter implements AgentAdapter<GooseConfig> {
  readonly id = 'goose';
  readonly displayName = 'Goose';
  readonly supportedProviderTypes = ['openai-compatible', 'anthropic-compatible', 'fireworks', 'openrouter', 'responses-compatible', 'custom-api'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'goose', 'config.yaml'),
      project: join(cwd ?? process.cwd(), '.goose', 'config.yaml'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<GooseConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    // Goose uses YAML — return raw text wrapped in an object so the base type is satisfied.
    return { raw };
  }

  buildConfig(_profile: Profile, _providers: Provider[]): GooseConfig {
    // Goose receives all configuration via environment variables (see buildEnv),
    // so we do not need to mutate the config file.
    return {};
  }

  /**
   * Builds the env vars Goose needs to pick up provider/model without interactive configure.
   *
   * Required keys (read by Goose config layer before checking config.yaml):
   *   GOOSE_PROVIDER — provider identifier string (e.g. "anthropic", "openai", "openrouter")
   *   GOOSE_MODEL    — model name string
   *
   * Provider-specific keys:
   *   anthropic      → ANTHROPIC_API_KEY, optionally ANTHROPIC_HOST (custom endpoint)
   *   openrouter     → OPENROUTER_API_KEY, optionally OPENROUTER_HOST (non-default endpoint)
   *   fireworks      → routed as GOOSE_PROVIDER=openai + OPENAI_API_KEY + OPENAI_HOST
   *   openai-compat  → GOOSE_PROVIDER=openai + OPENAI_API_KEY + OPENAI_HOST (baseUrl optional, defaults to https://api.openai.com/v1)
   */
  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const { model: base, provider } = resolveBaseModel(profile, providers);

    const env: Record<string, string> = {
      GOOSE_MODEL: base.model,
    };

    if (provider.type === 'anthropic-compatible') {
      env.GOOSE_PROVIDER = 'anthropic';
      env.ANTHROPIC_API_KEY = provider.apiKey;
      // Only set ANTHROPIC_HOST when overriding the default endpoint.
      if (provider.baseUrl && provider.baseUrl !== 'https://api.anthropic.com') {
        env.ANTHROPIC_HOST = provider.baseUrl;
      }
    } else if (provider.type === 'openrouter') {
      env.GOOSE_PROVIDER = 'openrouter';
      env.OPENROUTER_API_KEY = provider.apiKey;
      // Goose openrouter provider defaults to https://openrouter.ai — only override if custom.
      if (provider.baseUrl && !provider.baseUrl.startsWith(OPENROUTER_DEFAULT_HOST)) {
        env.OPENROUTER_HOST = provider.baseUrl;
      }
    } else if (provider.type === 'fireworks') {
      // Goose has no native fireworks provider; route via openai-compatible protocol.
      env.GOOSE_PROVIDER = 'openai';
      env.OPENAI_API_KEY = provider.apiKey;
      env.OPENAI_HOST = toGooseOpenAIHost(provider.baseUrl ?? DEFAULT_BASE_URLS.fireworks!);
    } else if (provider.type === 'responses-compatible') {
      if (!provider.baseUrl) {
        throw new Error('baseUrl required for responses-compatible provider in Goose');
      }
      env.GOOSE_PROVIDER = 'openai';
      env.OPENAI_API_KEY = provider.apiKey;
      env.OPENAI_HOST = toGooseOpenAIHost(provider.baseUrl);
    } else if (provider.type === 'custom-api') {
      if (provider.customApiModes?.anthropic) {
        env.GOOSE_PROVIDER = 'anthropic';
        env.ANTHROPIC_API_KEY = provider.apiKey;
        const host = resolveCustomApiUrl(provider, 'anthropic');
        if (host && host !== 'https://api.anthropic.com') {
          env.ANTHROPIC_HOST = host;
        }
      } else if (provider.customApiModes?.openai || provider.customApiModes?.responses) {
        env.GOOSE_PROVIDER = 'openai';
        env.OPENAI_API_KEY = provider.apiKey;
        const url = resolveCustomApiUrl(provider, 'openai') ?? resolveCustomApiUrl(provider, 'responses');
        if (!url) {
          throw new Error('Goose: custom-api provider must have openai or responses mode enabled');
        }
        env.OPENAI_HOST = toGooseOpenAIHost(url);
      } else {
        throw new Error(`Goose: custom-api provider "${provider.name}" requires at least one compatible mode (anthropic, openai, or responses)`);
      }
    } else {
      // openai-compatible — baseUrl is optional; falls back to https://api.openai.com/v1
      env.GOOSE_PROVIDER = 'openai';
      env.OPENAI_API_KEY = provider.apiKey;
      env.OPENAI_HOST = toGooseOpenAIHost(provider.baseUrl ?? DEFAULT_BASE_URLS['openai-compatible']!);
    }

    return env;
  }

  async writeConfig(_config: GooseConfig, _scope: LaunchScope, _cwd?: string, _mergeEnabled?: boolean): Promise<void> {
    // No-op: Goose receives all config via environment variables (see buildEnv).
    // There is nothing to write to config.yaml.
  }
}

export const gooseAdapter = new GooseAdapter();
