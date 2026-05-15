/**
 * Adapter for the OpenCode agent.
 *
 * Generates Vercel-AI-SDK-compatible configuration stored in JSON.
 * Supports all provider types (anthropic, openai-compatible, fireworks, openrouter).
 * Per-model modalities (image / video / audio) are emitted so the agent knows
 * which inputs the model accepts.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../config/atomic-write.js';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';

export interface OpenCodeProviderConfig {
  npm?: string;
  name?: string;
  options: Record<string, unknown>;
  models?: Record<string, { name: string; modalities: { input: string[]; output: string[] } }>;
  [key: string]: unknown;
}

export interface OpenCodeConfig {
  model: string;
  provider: Record<string, OpenCodeProviderConfig>;
  models?: Record<string, { modalities: { input: string[]; output: string[] } }>;
  [key: string]: unknown;
}

import { DEFAULT_BASE_URLS } from '../config/defaults.js';

/** Adapter for the OpenCode CLI agent. */
export class OpenCodeAdapter implements AgentAdapter<OpenCodeConfig> {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly supportedProviderTypes = ['anthropic-compatible', 'openai-compatible', 'fireworks', 'openrouter', 'responses-compatible', 'custom-api'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'opencode', 'config.json'),
      project: join(cwd ?? process.cwd(), 'opencode.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<OpenCodeConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as OpenCodeConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): OpenCodeConfig {
    const base = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
    if (!base) throw new Error(`Profile "${profile.name}" has no models`);

    const provider = providers.find((p) => p.id === base.providerId);
    if (!provider) throw new Error(`Provider not found for id: ${base.providerId}`);

    const modelConfig = provider.models.find((m) => m.name === base.model);
    const caps = modelConfig?.capabilities ?? { image: true, video: false, audio: false };
    const inputModalities: string[] = ['text'];
    if (caps.image) inputModalities.push('image');
    if (caps.video) inputModalities.push('video');
    if (caps.audio) inputModalities.push('audio');
    const modalities = { input: inputModalities, output: ['text'] };

    if (provider.type === 'anthropic-compatible') {
      const options: Record<string, unknown> = { apiKey: provider.apiKey };
      if (provider.baseUrl) options['baseURL'] = provider.baseUrl;
      return {
        model: `anthropic/${base.model}`,
        provider: { anthropic: { options } },
        models: { [base.model]: { modalities } },
      };
    }

    if (provider.type === 'fireworks') {
      const providerKey = provider.name.toLowerCase().replace(/\s+/g, '-');
      const options: Record<string, unknown> = { apiKey: provider.apiKey };
      options['baseURL'] = provider.baseUrl ?? DEFAULT_BASE_URLS.fireworks;
      return {
        model: `${providerKey}/${base.model}`,
        provider: {
          [providerKey]: {
            npm: '@ai-sdk/openai-compatible',
            name: provider.name,
            options,
            models: { [base.model]: { name: base.model, modalities } },
          },
        },
      };
    }

    if (provider.type === 'openrouter') {
      const options: Record<string, unknown> = {
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl ?? DEFAULT_BASE_URLS.openrouter,
      };
      return {
        model: `openrouter/${base.model}`,
        provider: {
          openrouter: {
            npm: '@ai-sdk/openai-compatible',
            name: provider.name,
            options,
            models: { [base.model]: { name: base.model, modalities } },
          },
        },
      };
    }

    if (provider.type === 'custom-api') {
      if (provider.customApiModes?.anthropic) {
        const options: Record<string, unknown> = { apiKey: provider.apiKey };
        const resolved = resolveCustomApiUrl(provider, 'anthropic');
        if (resolved) options['baseURL'] = resolved;
        return {
          model: `anthropic/${base.model}`,
          provider: { anthropic: { options } },
          models: { [base.model]: { modalities } },
        };
      }
      if (provider.customApiModes?.openai || provider.customApiModes?.responses) {
        const providerKey = provider.name.toLowerCase().replace(/\s+/g, '-');
        const options: Record<string, unknown> = { apiKey: provider.apiKey };
        const resolved = resolveCustomApiUrl(provider, 'openai') ?? resolveCustomApiUrl(provider, 'responses');
        if (resolved) options['baseURL'] = resolved;
        return {
          model: `${providerKey}/${base.model}`,
          provider: {
            [providerKey]: {
              npm: '@ai-sdk/openai-compatible',
              name: provider.name,
              options,
              models: { [base.model]: { name: base.model, modalities } },
            },
          },
        };
      }
      throw new Error(`OpenCode: custom-api provider "${provider.name}" requires at least one compatible mode (anthropic, openai, or responses)`);
    }

    // openai-compatible and responses-compatible: кастомный провайдер с именем из agento
    const resolvedBaseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type];

    // Use native @ai-sdk/openai when targeting the actual OpenAI API — it handles
    // model-specific parameters correctly (e.g. max_completion_tokens for gpt-5.x),
    // whereas @ai-sdk/openai-compatible always sends max_tokens which OpenAI rejects
    // for newer models.
    const isNativeOpenAI =
      provider.type === 'openai-compatible' &&
      (provider.baseUrl == null || provider.baseUrl === DEFAULT_BASE_URLS['openai-compatible']);

    if (isNativeOpenAI) {
      return {
        model: `openai/${base.model}`,
        provider: {
          openai: {
            npm: '@ai-sdk/openai',
            options: { apiKey: provider.apiKey },
            models: { [base.model]: { name: base.model, modalities } },
          },
        },
      };
    }

    const providerKey = provider.name.toLowerCase().replace(/\s+/g, '-');
    const options: Record<string, unknown> = { apiKey: provider.apiKey };
    if (resolvedBaseUrl) options['baseURL'] = resolvedBaseUrl;
    return {
      model: `${providerKey}/${base.model}`,
      provider: {
        [providerKey]: {
          npm: '@ai-sdk/openai-compatible',
          name: provider.name,
          options,
          models: { [base.model]: { name: base.model, modalities } },
        },
      },
    };
  }

  /**
   * Writes the agent config to disk.
   *
   * When `mergeEnabled` is true, reads the existing config and performs a
   * conservative shallow merge: unknown top-level keys are preserved, generated
   * keys overwrite, and nested objects are replaced whole. OpenCode has no
   * env-only flat-merge keys (`envKeys` is empty).
   */
  async writeConfig(config: OpenCodeConfig, scope: LaunchScope, cwd?: string, mergeEnabled?: boolean): Promise<void> {
    const path = this.configPaths(cwd)[scope];
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    if (mergeEnabled) {
      const existing = await this.readConfig(scope, cwd);
      if (existing) {
        config = mergeAgentConfig(existing, config, []);
      }
    }
    await writeJsonAtomic(path, config);
  }
}

export const openCodeAdapter = new OpenCodeAdapter();
