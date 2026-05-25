import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeJsonAtomic } from '../config/atomic-write.js';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider, ProviderType } from '../config/schema.js';
import { mergeAgentConfig } from './merge-config.js';

export interface PiConfig {
  defaultProvider?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

const MODELS_JSON_KEY = '__agento_models_json__';

/** Map AgentO provider type to PI built-in provider name. */
function mapToPiProvider(type: ProviderType, provider: Provider): string | null {
  if (type === 'anthropic-compatible') return 'anthropic';
  if (type === 'openai-compatible') return 'openai';
  if (type === 'fireworks') return 'fireworks';
  if (type === 'openrouter') return 'openrouter';
  if (type === 'custom-api') {
    const modes = provider.customApiModes;
    if (modes?.anthropic) return 'anthropic';
    if (modes?.openai) return 'openai';
    return null;
  }
  return null;
}

function getApiType(type: ProviderType, provider: Provider): string {
  if (type === 'anthropic-compatible' || (type === 'custom-api' && provider.customApiModes?.anthropic)) {
    return 'anthropic-messages';
  }
  // Everything else (openai-compatible, fireworks, openrouter, custom-api openai)
  // uses the OpenAI wire protocol.
  return 'openai-completions';
}

/** Mapping from AgentO provider types to PI env variable names. */
const PROVIDER_ENV_MAP: Record<ProviderType, string | null> = {
  'anthropic-compatible': 'ANTHROPIC_API_KEY',
  'openai-compatible': 'OPENAI_API_KEY',
  'fireworks': 'FIREWORKS_API_KEY',
  'openrouter': 'OPENROUTER_API_KEY',
  'responses-compatible': 'OPENAI_API_KEY',
  'custom-api': null,
};

export class PiAdapter implements AgentAdapter<PiConfig> {
  readonly id = 'pi';
  readonly displayName = 'PI';
  readonly supportedProviderTypes = [
    'anthropic-compatible',
    'openai-compatible',
    'fireworks',
    'openrouter',
    'custom-api',
  ] as const;

  configPaths(_cwd?: string): AgentConfigPaths {
    // PI resolves settings.json only from its agent directory (~/.pi/agent/),
    // not from the project directory. Both scopes must point to the same path
    // so AgentO backup/write and PI read land on the same file.
    const settingsPath = join(homedir(), '.pi', 'agent', 'settings.json');
    return {
      global: settingsPath,
      project: settingsPath,
    };
  }

  /** PI reads models.json only from its agent directory, not project-level. */
  private modelsJsonPath(): string {
    return join(homedir(), '.pi', 'agent', 'models.json');
  }

  async readConfig(
    scope: LaunchScope,
    cwd?: string,
  ): Promise<PiConfig | null> {
    const path = this.configPaths(cwd)[scope];
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as PiConfig;
  }

  buildConfig(profile: Profile, providers: Provider[]): PiConfig {
    const provider = providers.find(
      (p) => p.id === profile.models[0].providerId,
    );
    if (!provider) return {};

    const piProvider = mapToPiProvider(provider.type, provider);
    if (!piProvider) return {};

    const modelId = profile.models[0].model;

    // Build models.json content with provider override + custom model so PI
    // can resolve the model from the profile instead of falling back to the
    // built-in default model for the provider.
    const apiType = getApiType(provider.type, provider);
    const modelsJson: Record<string, unknown> = {
      providers: {
        [piProvider]: {
          models: [
            {
              id: modelId,
              name: modelId,
              api: apiType,
            },
          ],
        },
      },
    };
    if (provider.baseUrl) {
      const providerOverride = (modelsJson.providers as Record<string, Record<string, unknown>>)[piProvider];
      providerOverride.baseUrl = provider.baseUrl;
    }

    const config: PiConfig = {
      defaultProvider: piProvider,
      defaultModel: modelId,
      [MODELS_JSON_KEY]: modelsJson,
    };
    return config;
  }

  async writeConfig(
    config: PiConfig,
    scope: LaunchScope,
    cwd?: string,
    mergeEnabled?: boolean,
  ): Promise<void> {
    // Extract and remove the embedded models.json payload before writing settings.json
    const modelsJson = config[MODELS_JSON_KEY] as Record<string, unknown> | undefined;
    delete (config as Record<string, unknown>)[MODELS_JSON_KEY];

    const path = this.configPaths(cwd)[scope];
    await mkdir(dirname(path), { recursive: true });

    const existing = await this.readConfig(scope, cwd);
    const merged =
      mergeEnabled && existing ? mergeAgentConfig(existing, config, []) : config;
    await writeJsonAtomic(path, merged);

    // Write models.json to PI agent dir (PI reads only from agent dir)
    if (modelsJson && Object.keys(modelsJson).length > 0) {
      const modelsPath = this.modelsJsonPath();
      await mkdir(dirname(modelsPath), { recursive: true });
      await writeJsonAtomic(modelsPath, modelsJson);
    }
  }

  buildEnv(profile: Profile, providers: Provider[]): Record<string, string> {
    const provider = providers.find(
      (p) => p.id === profile.models[0].providerId,
    );
    if (!provider) throw new Error('Provider not found');

    const env: Record<string, string> = {};
    const type = provider.type;

    if (type === 'custom-api') {
      const modes = provider.customApiModes;
      if (!modes || (!modes.openai && !modes.anthropic)) {
        throw new Error(
          'PI requires a custom-api provider with either openai or anthropic wire protocol. Enable one in the provider settings.',
        );
      }
      if (modes.anthropic) {
        env['ANTHROPIC_API_KEY'] = provider.apiKey;
      } else if (modes.openai) {
        env['OPENAI_API_KEY'] = provider.apiKey;
      }
    } else {
      const envVar = PROVIDER_ENV_MAP[type];
      if (!envVar) {
        throw new Error(`Provider type ${type} is not supported by PI`);
      }
      env[envVar] = provider.apiKey;
    }

    return env;
  }
}

export const piAdapter = new PiAdapter();
