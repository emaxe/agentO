/**
 * Adapter for Hermes Agent (Nous Research) — both the CLI and the Desktop app.
 *
 * Hermes keeps a single YAML config per installation:
 *   $HERMES_HOME/config.yaml            (when HERMES_HOME is set)
 *   %LOCALAPPDATA%\hermes\config.yaml   (native Windows)
 *   ~/.hermes/config.yaml               (POSIX)
 *
 * There is no project-level config, so both AgentO scopes resolve to the same
 * file (the same approach as the Kimi adapter). Everything else in the file —
 * toolsets, gateway, hooks, memory, `_config_version` — must survive a launch,
 * so writes merge the generated `model` / `providers` sections into the
 * existing document instead of replacing it.
 *
 * The model selection Hermes understands:
 *   model.provider  → key in `providers`
 *   model.default   → model name
 *   model.base_url  → endpoint
 *   model.api_key   → credential (Hermes keeps keys inline in config.yaml)
 *
 * `providers.<key>` accepts `name`, `api` (or `base_url`/`url`), one of
 * `api_key` / `key_env`, `default_model`, `models[]` and `transport`
 * (`chat_completions` | `anthropic_messages` | `codex_responses`).
 * The adapter writes the credential inline because Hermes Desktop reuses an
 * already-running Electron instance, so environment injection at launch time
 * is not reliably seen by the app.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AgentAdapter, AgentConfigPaths } from './base.js';
import type { LaunchScope } from './base.js';
import type { Profile, Provider } from '../config/schema.js';
import { resolveCustomApiUrl } from '../config/schema.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';
import { writeFileAtomic } from '../config/atomic-write.js';
import { resolveBaseModel } from './resolve-base-model.js';

/** Wire protocol Hermes uses for a provider entry. */
export type HermesTransport = 'chat_completions' | 'anthropic_messages' | 'codex_responses';

export interface HermesProviderEntry extends Record<string, unknown> {
  name: string;
  api: string;
  default_model: string;
  models: string[];
  api_key: string;
  transport?: HermesTransport;
}

export interface HermesModelSection extends Record<string, unknown> {
  provider: string;
  default: string;
  base_url: string;
  api_key: string;
}

export interface HermesConfig extends Record<string, unknown> {
  model?: HermesModelSection;
  providers?: Record<string, HermesProviderEntry>;
}

export interface HermesAdapterOptions {
  /** Agent id used by the registry (`hermes` or `hermes-desktop`). */
  id: string;
  /** Human-readable name shown in the TUI/CLI. */
  displayName: string;
  /** Defaults to `process.platform`; injectable so the Windows path is testable. */
  platform?: NodeJS.Platform;
  /** Defaults to `os.homedir()`; injectable so tests do not touch the real home. */
  home?: string;
}

/** Prefix keeps AgentO entries from shadowing Hermes' built-in provider slugs. */
const PROVIDER_KEY_PREFIX = 'agento-';

export function hermesProviderKey(provider: Provider): string {
  const slug = provider.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Provider names may be non-Latin (AgentO allows them); fall back to the id.
  return `${PROVIDER_KEY_PREFIX}${slug || provider.id.slice(0, 8)}`;
}

/** Adapter for the Hermes Agent CLI and the Hermes Desktop app. */
export class HermesAdapter implements AgentAdapter<HermesConfig> {
  readonly id: string;
  readonly displayName: string;
  readonly supportedProviderTypes = [
    'openai-compatible',
    'anthropic-compatible',
    'fireworks',
    'openrouter',
    'responses-compatible',
    'custom-api',
  ] as const;

  private readonly _platform: NodeJS.Platform;
  private readonly _home: string;

  constructor(options: HermesAdapterOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this._platform = options.platform ?? process.platform;
    this._home = options.home ?? homedir();
  }

  /** Hermes' install root: `HERMES_HOME`, then the platform-specific default. */
  private hermesHome(): string {
    const override = process.env.HERMES_HOME?.trim();
    if (override) return override;

    const join = this._platform === 'win32' ? path.win32.join : path.posix.join;
    if (this._platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA?.trim();
      if (localAppData) return join(localAppData, 'hermes');
      return join(this._home, 'AppData', 'Local', 'hermes');
    }
    return join(this._home, '.hermes');
  }

  private configPath(): string {
    const join = this._platform === 'win32' ? path.win32.join : path.posix.join;
    return join(this.hermesHome(), 'config.yaml');
  }

  configPaths(_cwd?: string): AgentConfigPaths {
    // Hermes has no project-scoped config; both scopes point at the same file.
    const file = this.configPath();
    return { global: file, project: file };
  }

  async readConfig(_scope: LaunchScope, _cwd?: string): Promise<HermesConfig | null> {
    const file = this.configPath();
    if (!existsSync(file)) return null;

    const raw = await readFile(file, 'utf-8');
    const parsed: unknown = parseYaml(raw);
    if (parsed === null || parsed === undefined) return null;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Hermes config at ${file} is not a YAML mapping`);
    }
    return parsed as HermesConfig;
  }

  /** Resolves the endpoint and wire protocol for a provider. */
  private resolveEndpoint(provider: Provider): { baseUrl: string; transport: HermesTransport } {
    switch (provider.type) {
      case 'anthropic-compatible':
        return {
          baseUrl: provider.baseUrl ?? DEFAULT_BASE_URLS['anthropic-compatible']!,
          transport: 'anthropic_messages',
        };
      case 'responses-compatible':
        if (!provider.baseUrl) {
          throw new Error(
            `Hermes: responses-compatible provider "${provider.name}" requires a baseUrl`,
          );
        }
        return { baseUrl: provider.baseUrl, transport: 'codex_responses' };
      case 'custom-api': {
        const mode = provider.customApiModes?.anthropic
          ? 'anthropic'
          : provider.customApiModes?.responses
            ? 'responses'
            : provider.customApiModes?.openai
              ? 'openai'
              : null;
        if (!mode) {
          throw new Error(
            `Hermes: custom-api provider "${provider.name}" requires at least one API mode (openai, anthropic, or responses)`,
          );
        }
        const baseUrl = resolveCustomApiUrl(provider, mode);
        if (!baseUrl) {
          throw new Error(`Hermes: custom-api provider "${provider.name}" is missing a baseUrl`);
        }
        return {
          baseUrl,
          transport:
            mode === 'anthropic'
              ? 'anthropic_messages'
              : mode === 'responses'
                ? 'codex_responses'
                : 'chat_completions',
        };
      }
      default: {
        // openai-compatible / fireworks / openrouter
        const baseUrl = provider.baseUrl ?? DEFAULT_BASE_URLS[provider.type];
        if (!baseUrl) {
          throw new Error(`Hermes: provider "${provider.name}" requires a baseUrl`);
        }
        return { baseUrl, transport: 'chat_completions' };
      }
    }
  }

  buildConfig(profile: Profile, providers: Provider[]): HermesConfig {
    const { model: base, provider } = resolveBaseModel(profile, providers);
    const { baseUrl, transport } = this.resolveEndpoint(provider);
    const providerKey = hermesProviderKey(provider);

    return {
      model: {
        provider: providerKey,
        default: base.model,
        base_url: baseUrl,
        api_key: provider.apiKey,
      },
      providers: {
        [providerKey]: {
          name: provider.name,
          api: baseUrl,
          default_model: base.model,
          models: [base.model],
          api_key: provider.apiKey,
          // `chat_completions` is Hermes' default for OpenAI-style endpoints,
          // so it is left implicit; the other two must be explicit.
          ...(transport === 'chat_completions' ? {} : { transport }),
        },
      },
    };
  }

  async writeConfig(
    config: HermesConfig,
    scope: LaunchScope,
    cwd?: string,
    mergeEnabled?: boolean,
  ): Promise<void> {
    const file = this.configPath();
    await mkdir(dirname(file), { recursive: true });

    let output: HermesConfig = config;
    if (mergeEnabled) {
      const existing = await this.readConfig(scope, cwd);
      if (existing) output = mergeHermesConfig(existing, config);
    }

    // Hermes writes its config with owner-only permissions; match it.
    await writeFileAtomic(file, stringifyYaml(output, { lineWidth: 0 }), 0o600);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Conservative merge for Hermes: keep every top-level key that AgentO does not
 * own, merge `model` key-by-key and `providers` entry-by-entry so other
 * providers and unrelated model settings survive.
 */
export function mergeHermesConfig(existing: HermesConfig, generated: HermesConfig): HermesConfig {
  const result: HermesConfig = { ...existing };

  for (const [key, value] of Object.entries(generated)) {
    if (key === 'model' && isPlainObject(value) && isPlainObject(result.model)) {
      result.model = { ...result.model, ...value } as HermesModelSection;
    } else if (key === 'providers' && isPlainObject(value) && isPlainObject(result.providers)) {
      result.providers = { ...result.providers, ...value } as Record<string, HermesProviderEntry>;
    } else {
      result[key] = value;
    }
  }

  return result;
}

export const hermesAdapter = new HermesAdapter({
  id: 'hermes',
  displayName: 'Hermes Agent',
});

export const hermesDesktopAdapter = new HermesAdapter({
  id: 'hermes-desktop',
  displayName: 'Hermes Desktop',
});
