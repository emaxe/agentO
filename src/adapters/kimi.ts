/**
 * Adapter for the Kimi Code CLI agent.
 *
 * Kimi Code is Moonshot AI's official CLI coding agent (kimi-cli, PyPI).
 * Configuration is stored in a single global TOML file:
 *   ~/.kimi/config.toml
 * Both AgentO scopes (global and project) point to the same file since Kimi
 * does not support project-level configuration.
 *
 * The adapter generates the providers / models / default_model sections and
 * preserves all user-defined top-level keys (loop_control, background, theme,
 * hooks, mcp, services, etc.) through a conservative shallow merge.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';
import { resolveBaseModel } from './resolve-base-model.js';

/** Known Kimi context sizes for specific models. */
const KIMI_CONTEXT_SIZES: Record<string, number> = {
  'kimi-k2-6': 131072,
  'kimi-k2-5': 131072,
  'kimi-k1-5': 131072,
  'kimi-for-coding': 131072,
  'kimi-k2': 131072,
  'kimi-k1': 131072,
};

function getMaxContextSize(modelName: string): number {
  return KIMI_CONTEXT_SIZES[modelName] ?? 131072;
}

/** Kimi CLI provider types. */
type KimiProviderType = 'kimi' | 'openai_legacy' | 'openai_responses' | 'anthropic' | 'gemini';

/** Map AgentO provider type to Kimi provider type. */
function mapToKimiProviderType(type: string, provider: Provider): KimiProviderType {
  if (type === 'anthropic-compatible') return 'anthropic';
  if (type === 'openai-compatible') return 'openai_legacy';
  if (type === 'responses-compatible') return 'openai_responses';
  if (type === 'fireworks') return 'openai_legacy';
  if (type === 'openrouter') return 'openai_legacy';
  if (type === 'custom-api') {
    const modes = provider.customApiModes;
    if (modes?.anthropic) return 'anthropic';
    if (modes?.responses) return 'openai_responses';
    if (modes?.openai) return 'openai_legacy';
    // With no mode enabled there is no wire protocol to speak. Domain validation
    // rejects such a provider on creation; throwing here keeps a hand-edited
    // config from producing a Kimi profile that silently points nowhere.
    throw new Error(
      `Kimi Code: custom-api provider "${provider.name}" requires at least one API mode (openai, anthropic, or responses)`,
    );
  }
  return 'openai_legacy';
}

/** Map AgentO capabilities to Kimi capability strings. */
function mapCapabilities(capabilities: {
  image?: boolean;
  video?: boolean;
  audio?: boolean;
}): string[] {
  const caps: string[] = [];
  if (capabilities.image) caps.push('image_in');
  if (capabilities.video) caps.push('video_in');
  // Kimi also supports 'thinking' and 'always_thinking' but AgentO does not
  // expose those flags at the moment, so we leave them unset.
  return caps;
}

/** Base URLs for known providers when not overridden. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export interface KimiProviderConfig {
  type: KimiProviderType;
  base_url: string;
  api_key: string;
  env?: Record<string, string>;
  custom_headers?: Record<string, string>;
  reasoning_key?: string;
}

export interface KimiModelConfig {
  provider: string;
  model: string;
  max_context_size: number;
  capabilities?: string[];
  display_name?: string;
}

export interface KimiConfig {
  default_model?: string;
  default_thinking?: boolean;
  default_yolo?: boolean;
  default_plan_mode?: boolean;
  theme?: 'dark' | 'light';
  telemetry?: boolean;
  show_thinking_stream?: boolean;
  default_editor?: string;
  providers?: Record<string, KimiProviderConfig>;
  models?: Record<string, KimiModelConfig>;
  [key: string]: unknown;
}

/** Adapter for Kimi Code CLI. */
export class KimiAdapter implements AgentAdapter<KimiConfig> {
  readonly id = 'kimi';
  readonly displayName = 'Kimi Code';
  readonly supportedProviderTypes = [
    'anthropic-compatible',
    'openai-compatible',
    'fireworks',
    'openrouter',
    'responses-compatible',
    'custom-api',
  ] as const;

  private getConfigPath(): string {
    return join(homedir(), '.kimi', 'config.toml');
  }

  private getLegacyJsonPath(): string {
    return join(homedir(), '.kimi', 'config.json');
  }

  configPaths(_cwd?: string): AgentConfigPaths {
    const p = this.getConfigPath();
    return { global: p, project: p };
  }

  async readConfig(_scope: LaunchScope, _cwd?: string): Promise<KimiConfig | null> {
    // Try TOML first (canonical), fall back to legacy JSON
    const tomlPath = this.getConfigPath();
    if (existsSync(tomlPath)) {
      const raw = await readFile(tomlPath, 'utf-8');
      try {
        return parseToml(raw) as KimiConfig;
      } catch {
        // Fall through to legacy JSON
      }
    }
    const jsonPath = this.getLegacyJsonPath();
    if (existsSync(jsonPath)) {
      const raw = await readFile(jsonPath, 'utf-8');
      return JSON.parse(raw) as KimiConfig;
    }
    return null;
  }

  buildConfig(profile: Profile, providers: Provider[]): KimiConfig {
    const { model: base, provider } = resolveBaseModel(profile, providers);

    const kimiType = mapToKimiProviderType(provider.type, provider);
    const providerName = provider.name.toLowerCase().replace(/\s+/g, '-');

    // Determine base URL
    let baseUrl = provider.baseUrl ?? '';
    if (!baseUrl) {
      if (provider.type === 'fireworks') baseUrl = DEFAULT_BASE_URLS.fireworks;
      else if (provider.type === 'openrouter') baseUrl = DEFAULT_BASE_URLS.openrouter;
      else if (provider.type === 'custom-api') {
        // For custom-api, use provider baseUrl if set; Kimi CLI does not define
        // a universal default, so an empty string is acceptable.
        baseUrl = provider.baseUrl ?? '';
      }
    }

    const modelName = base.model;
    const maxContextSize = getMaxContextSize(modelName);

    // Build provider config
    const kimiProvider: KimiProviderConfig = {
      type: kimiType,
      base_url: baseUrl,
      api_key: provider.apiKey,
    };

    const caps = mapCapabilities(
      provider.models.find((m) => m.name === modelName)?.capabilities ?? {},
    );

    const kimiModel: KimiModelConfig = {
      provider: providerName,
      model: modelName,
      max_context_size: maxContextSize,
      ...(caps.length > 0 ? { capabilities: caps } : {}),
      display_name: modelName,
    };

    return {
      default_model: modelName,
      providers: { [providerName]: kimiProvider },
      models: { [modelName]: kimiModel },
    };
  }

  async writeConfig(
    config: KimiConfig,
    scope: LaunchScope,
    cwd?: string,
    mergeEnabled?: boolean,
  ): Promise<void> {
    const path = this.getConfigPath();
    await mkdir(dirname(path), { recursive: true });

    let merged = config;

    if (mergeEnabled) {
      const existing = await this.readConfig(scope, cwd);
      if (existing) {
        merged = mergeAgentConfig(existing, config, []);
      }
    }

    // Remove undefined/null values for clean TOML output
    const cleaned = stripUndefined(merged);
    const toml = stringifyToml(cleaned);
    await writeFileAtomic(path, toml);

    // Also remove legacy JSON so Kimi CLI does not see stale config
    const legacyJson = this.getLegacyJsonPath();
    if (existsSync(legacyJson)) {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(legacyJson);
      } catch {
        // Best-effort removal
      }
    }
  }
}

/** Recursively strip keys whose value is undefined or null. */
function stripUndefined(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      result[k] = stripUndefined(v);
    }
    return result;
  }
  return obj;
}

/** Atomically write a text file by writing to a temp file and renaming. */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const { writeFile, rename } = await import('node:fs/promises');
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, path);
}

export const kimiAdapter = new KimiAdapter();
