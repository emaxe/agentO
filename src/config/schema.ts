import { z } from 'zod';

// Тип провайдера API
export const ProviderTypeSchema = z.enum(['openai-compatible', 'anthropic']);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// Провайдер API (REQ-1)
export const ProviderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: ProviderTypeSchema,
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  models: z.array(z.string().min(1)).min(1),
});
export type Provider = z.infer<typeof ProviderSchema>;

// Пара провайдер+модель в профиле
export const ProfileModelSchema = z.object({
  providerId: z.string().uuid(),
  model: z.string().min(1),
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
export const AgentIdSchema = z.enum(['claude-code', 'opencode']);
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
  defaultConfigScope: LaunchScopeSchema.default('global'),
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
