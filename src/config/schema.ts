import { z } from 'zod';

// Тип провайдера API
export const ProviderTypeSchema = z.enum([
  'openai-compatible',
  'anthropic-compatible',
  'fireworks',
  'openrouter',
  'responses-compatible',
  'custom-api',
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export const PROVIDER_TYPES = ProviderTypeSchema.options;

// Sub-modes для универсального custom-api провайдера
export const CustomApiModesSchema = z.object({
  openai: z.boolean().default(false),
  anthropic: z.boolean().default(false),
  responses: z.boolean().default(false),
});
export type CustomApiModes = z.infer<typeof CustomApiModesSchema>;

// Возможности модели (image / video / audio)
export const ModelCapabilitiesSchema = z.object({
  image: z.boolean().default(true),
  video: z.boolean().default(false),
  audio: z.boolean().default(false),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

// Модель провайдера с capabilities
export const ModelConfigSchema = z.object({
  name: z.string().min(1),
  capabilities: ModelCapabilitiesSchema.default({}),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Провайдер API (REQ-1)
export const ProviderSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    type: ProviderTypeSchema,
    apiKey: z.string().min(1),
    baseUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    models: z.array(ModelConfigSchema).min(1),
    customApiModes: CustomApiModesSchema.optional(),
  })
  .transform((data) => {
    if (data.baseUrl && data.type === 'custom-api') {
      data.baseUrl = data.baseUrl.replace(/\/v1\/?$/, '');
    }
    return data;
  });
export type Provider = z.infer<typeof ProviderSchema>;

/** Маркер capabilities для отображения в UI: [i--], [iva] и т.д. */
export function capabilityMarker(caps: ModelCapabilities): string {
  return `[${caps.image ? 'i' : '-'}${caps.video ? 'v' : '-'}${caps.audio ? 'a' : '-'}]`;
}

/**
 * Resolves the effective API base URL for a provider.
 * For `custom-api`, it appends the endpoint suffix based on the requested mode:
 *   openai       → baseUrl + '/v1'   (client appends only /chat/completions —
 *                  see DEFAULT_BASE_URLS in defaults.ts, which bakes /v1 into
 *                  every OpenAI-style default for the same reason)
 *   anthropic    → baseUrl           (client appends its own /v1/messages —
 *                  see DEFAULT_ANTHROPIC_BASE_URLS in defaults.ts for the same convention)
 *   responses    → baseUrl + '/v1/responses'
 * The two conventions are opposite on purpose: Anthropic-style clients (Claude Code,
 * the Anthropic SDK, Vercel `@ai-sdk/anthropic`) insert `/v1` themselves before
 * `/messages`, so adding it here would double it up. OpenAI-style consumers (Qwen,
 * OpenCode/Kilo/Copilot in openai mode, Codex) do not insert a version segment at
 * all — they only ever append the endpoint path — so `/v1` must be added here or
 * requests land on the wrong path entirely (e.g. a bare custom-api host without
 * `/v1` produced a 404 web-app fallback page for Qwen instead of hitting the API).
 * Returns `undefined` when the provider is not custom-api or the requested mode is not enabled.
 */
export function resolveCustomApiUrl(
  provider: Provider,
  mode: 'openai' | 'anthropic' | 'responses',
): string | undefined {
  if (provider.type !== 'custom-api') {
    return provider.baseUrl;
  }
  if (!provider.customApiModes?.[mode]) {
    return undefined;
  }
  const suffix = mode === 'anthropic' ? '' : mode === 'openai' ? '/v1' : '/v1/responses';
  return provider.baseUrl ? provider.baseUrl + suffix : undefined;
}

// Уровень модели в профиле (REQ: small / base / smart)
export const ModelTierSchema = z.enum(['small', 'base', 'smart']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

// Пара провайдер+модель в профиле
export const ProfileModelSchema = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1),
  tier: ModelTierSchema.optional(),
});
export type ProfileModel = z.infer<typeof ProfileModelSchema>;

// Профиль (REQ-2)
export const ProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  models: z.array(ProfileModelSchema).min(1),
});
export type Profile = z.infer<typeof ProfileSchema>;

// Поддерживаемые агенты (REQ-8)
export const AgentIdSchema = z.enum(['claude-code', 'opencode', 'qwen', 'codex', 'copilot', 'goose', 'pi', 'kilo', 'kimi']);
export type AgentId = z.infer<typeof AgentIdSchema>;

// Scope конфига (REQ-5)
export const LaunchScopeSchema = z.enum(['global', 'project']);
export type LaunchScope = z.infer<typeof LaunchScopeSchema>;

// Режим запуска (REQ-4)
export const LaunchModeSchema = z.enum(['child', 'independent']);
export type LaunchMode = z.infer<typeof LaunchModeSchema>;

// Настройки AgentO (REQ-3, REQ-11)
export const SettingsSchema = z.object({
  defaultLaunchMode: LaunchModeSchema.default('child'),
  defaultConfigScope: LaunchScopeSchema.default('project'),
  mergeAgentConfigs: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;

// Корневой конфиг AgentO (~/.agento/config.json) (REQ-3)
export const AgentOConfigSchema = z.object({
  providers: z.array(ProviderSchema).default([]),
  profiles: z.array(ProfileSchema).default([]),
  settings: SettingsSchema.default({}),
});
export type AgentOConfig = z.infer<typeof AgentOConfigSchema>;

// Базовый тип конфига агента (REQ-7)
export const AgentConfigSchema = z.record(z.unknown());
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
