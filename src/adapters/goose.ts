import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';

/**
 * Default base URLs for providers that Goose accesses via OpenAI-compatible protocol.
 * Used only for `fireworks` (Goose has no native fireworks provider).
 */
const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';

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

/**
 * Default OpenRouter host (without path). Goose's openrouter provider appends its own path.
 * Only set OPENROUTER_HOST when the user configured a non-default endpoint.
 */
const OPENROUTER_DEFAULT_HOST = 'https://openrouter.ai';

export class GooseAdapter implements AgentAdapter {
  readonly id = 'goose';
  readonly displayName = 'Goose';
  readonly supportedProviderTypes = ['openai-compatible', 'anthropic', 'fireworks', 'openrouter'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'goose', 'config.yaml'),
      project: join(cwd ?? process.cwd(), '.goose', 'config.yaml'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    // Goose uses YAML — return raw text wrapped in an object so the base type is satisfied.
    return { raw } as AgentConfig;
  }

  buildConfig(_profile: Profile, _providers: Provider[]): AgentConfig {
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
   *   openai-compat  → GOOSE_PROVIDER=openai + OPENAI_API_KEY + OPENAI_HOST (baseUrl required)
   */
  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) return {};

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) return {};

    const env: Record<string, string> = {
      GOOSE_MODEL: base.model,
    };

    if (provider.type === 'anthropic') {
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
      env.OPENAI_HOST = toGooseOpenAIHost(provider.baseUrl ?? FIREWORKS_BASE_URL);
    } else {
      // openai-compatible
      if (!provider.baseUrl) {
        throw new Error('baseUrl required for openai-compatible provider in Goose');
      }
      env.GOOSE_PROVIDER = 'openai';
      env.OPENAI_API_KEY = provider.apiKey;
      env.OPENAI_HOST = toGooseOpenAIHost(provider.baseUrl);
    }

    return env;
  }

  async writeConfig(_config: AgentConfig, _scope: LaunchScope, _cwd?: string, _mergeEnabled?: boolean): Promise<void> {
    // No-op: Goose receives all config via environment variables (see buildEnv).
    // There is nothing to write to config.yaml.
  }
}

export const gooseAdapter = new GooseAdapter();
