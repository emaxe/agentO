/**
 * Adapter for the Kilo Code CLI agent.
 *
 * Kilo Code is a fork of OpenCode, so this adapter mirrors the OpenCode adapter
 * with branding-specific paths (kilocode.json) and provider mappings.
 *
 * Generates Vercel-AI-SDK-compatible configuration stored in JSON.
 * Supports all provider types (anthropic, openai-compatible, fireworks, openrouter).
 */
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

export interface KiloProviderConfig {
  npm?: string;
  name?: string;
  options: Record<string, unknown>;
  models?: Record<string, { name: string; modalities: { input: string[]; output: string[] } }>;
  [key: string]: unknown;
}

export interface KiloConfig {
  model: string;
  provider: Record<string, KiloProviderConfig>;
  models?: Record<string, { modalities: { input: string[]; output: string[] } }>;
  [key: string]: unknown;
}

import { DEFAULT_BASE_URLS } from '../config/defaults.js';
import { resolveBaseModel } from './resolve-base-model.js';

/** Adapter for the Kilo Code CLI agent. */
export class KiloAdapter implements AgentAdapter<KiloConfig> {
  readonly id = 'kilo';
  readonly displayName = 'Kilo Code';
  readonly supportedProviderTypes = [
    'anthropic-compatible',
    'openai-compatible',
    'fireworks',
    'openrouter',
    'responses-compatible',
    'custom-api',
  ] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'kilocode', 'config.json'),
      project: join(cwd ?? process.cwd(), 'kilocode.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<KiloConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as KiloConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): KiloConfig {
    const { model: base, provider } = resolveBaseModel(profile, providers);

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
        const resolved =
          resolveCustomApiUrl(provider, 'openai') ?? resolveCustomApiUrl(provider, 'responses');
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
      throw new Error(
        `Kilo Code: custom-api provider "${provider.name}" requires at least one compatible mode (anthropic, openai, or responses)`,
      );
    }

    // openai-compatible and responses-compatible: custom provider named from agento
    const resolvedBaseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type];

    // Use native @ai-sdk/openai when targeting the actual OpenAI API
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
   * keys overwrite, and nested objects are replaced whole. Kilo has no
   * env-only flat-merge keys (`envKeys` is empty).
   */
  async writeConfig(
    config: KiloConfig,
    scope: LaunchScope,
    cwd?: string,
    mergeEnabled?: boolean,
  ): Promise<void> {
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

export const kiloAdapter = new KiloAdapter();
