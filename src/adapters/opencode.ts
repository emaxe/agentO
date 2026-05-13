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
import type { AgentAdapter, AgentConfig, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';

/** Default API base URLs for provider types that need them. */
const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Adapter for the OpenCode CLI agent. */
export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly supportedProviderTypes = ['anthropic', 'openai-compatible', 'fireworks', 'openrouter'] as const;

  configPaths(cwd?: string): AgentConfigPaths {
    return {
      global: join(homedir(), '.config', 'opencode', 'config.json'),
      project: join(cwd ?? process.cwd(), 'opencode.json'),
    };
  }

  async readConfig(scope: LaunchScope, cwd?: string): Promise<AgentConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AgentConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): AgentConfig {
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

    if (provider.type === 'anthropic') {
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

    // openai-compatible: кастомный провайдер с именем из agento
    const providerKey = provider.name.toLowerCase().replace(/\s+/g, '-');
    const options: Record<string, unknown> = { apiKey: provider.apiKey };
    if (provider.baseUrl) options['baseURL'] = provider.baseUrl;
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

  async writeConfig(config: AgentConfig, scope: LaunchScope, cwd?: string, mergeEnabled?: boolean): Promise<void> {
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
