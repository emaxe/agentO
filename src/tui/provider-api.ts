import type { ProviderType } from '../config/schema.js';
import { DEFAULT_BASE_URLS } from '../config/defaults.js';

/** Provider types that expose an OpenAI-compatible /v1/models endpoint. */
const OPENAI_COMPATIBLE_TYPES = new Set<ProviderType>([
  'openai-compatible',
  'fireworks',
  'openrouter',
  'custom-api',
]);

/**
 * Returns true if the provider type exposes an OpenAI-compatible /v1/models endpoint.
 * Used to conditionally show "Test API" and "Fetch models" buttons in the form.
 */
export function isOpenAICompatible(type: ProviderType): boolean {
  return OPENAI_COMPATIBLE_TYPES.has(type);
}

/**
 * Resolves the effective base URL for the /models request.
 * For types with a known default, uses that when baseUrl is empty.
 * For custom-api, returns the raw form value (or '' if not provided).
 *
 * @param type     - Provider type from form state
 * @param baseUrl  - Raw baseUrl value from the form (may be empty string)
 * @returns Resolved base URL to use when calling `fetchProviderModels`
 */
export function resolveModelsBaseUrl(type: ProviderType, baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed) return trimmed;
  return DEFAULT_BASE_URLS[type] ?? '';
}

/** Successful result from `fetchProviderModels`. */
export interface FetchModelsResult {
  ok: true;
  /** Sorted list of model id strings from the /models response. */
  models: string[];
}

/** Error result from `fetchProviderModels`. */
export interface FetchModelsError {
  ok: false;
  error: string;
}

/** Union result type returned by `fetchProviderModels`. */
export type FetchModelsOutcome = FetchModelsResult | FetchModelsError;

/**
 * Fetches the list of available models from a provider's /models endpoint.
 *
 * Makes a GET request to `{baseUrl}/models` with an Authorization: Bearer header.
 * Expects the OpenAI-standard response format: `{ data: Array<{ id: string }> }`.
 *
 * @param baseUrl - Resolved base URL (e.g. "https://api.openai.com/v1")
 * @param apiKey  - API key to include in the Authorization header
 * @param signal  - Optional AbortSignal to cancel the in-flight request
 * @returns Sorted model id list on success, or a descriptive error string on failure
 */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FetchModelsOutcome> {
  if (!baseUrl) {
    return { ok: false, error: 'Base URL is required to test the API.' };
  }

  const url = baseUrl.replace(/\/$/, '') + '/models';

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter(Boolean)
      .sort();

    return { ok: true, models };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Запрос отменён.' };
    }
    return { ok: false, error: String(err) };
  }
}
