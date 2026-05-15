import type { ProviderType } from './schema.js';

/**
 * Default base URLs for OpenAI-compatible providers.
 *
 * These URLs include the /v1 path segment because consuming
 * agents/SDKs (Codex, Qwen, OpenCode, Copilot, Goose) append
 * their own endpoint paths after the base URL.
 */
export const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  'openai-compatible': 'https://api.openai.com/v1',
  'anthropic-compatible': 'https://api.anthropic.com',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * Default base URLs for Anthropic-compatible endpoints used by Claude Code.
 *
 * Claude Code expects these for non-Anthropic providers that speak the
 * Anthropic wire protocol.  Paths intentionally do NOT include /v1 because
 * Claude Code (or the Anthropic SDK) appends it internally.
 */
export const DEFAULT_ANTHROPIC_BASE_URLS: Partial<Record<ProviderType, string>> = {
  fireworks: 'https://api.fireworks.ai/inference',
  openrouter: 'https://openrouter.ai/api',
  'openai-compatible': 'https://api.openai.com/v1',
};
