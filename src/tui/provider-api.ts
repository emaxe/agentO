import type { ProviderType } from '../config/schema.js';
import { stripApiVersionSuffix } from '../config/schema.js';
import { findNonAsciiApiKeyChar } from '../config/validation.js';
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
 * For custom-api, mirrors `resolveCustomApiUrl(provider, 'openai')`: /models is an
 * OpenAI-style endpoint, so the openai-mode root (base + '/v1') is the one to probe.
 * A trailing /v1 in the stored baseUrl is not doubled.
 * For custom-api without a baseUrl, returns ''.
 *
 * @param type     - Provider type from form state
 * @param baseUrl  - Raw baseUrl value from the form (may be empty string)
 * @returns Resolved base URL to use when calling `fetchProviderModels`
 */
export function resolveModelsBaseUrl(type: ProviderType, baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (type === 'custom-api') {
    const base = trimmed ? stripApiVersionSuffix(trimmed) : '';
    return base ? `${base}/v1` : '';
  }
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

/** Longest response snippet kept in an error message. */
const MAX_ERROR_DETAIL = 200;

/** Terminal color/mode sequences that must never reach the TUI. */
// eslint-disable-next-line no-control-regex -- intentionally strips ANSI escapes from server bodies.
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Flattens an error body or message into one short line.
 *
 * `fetchProviderModels` results are rendered inside a single Ink row. Raw
 * response text (HTML error pages, stack traces, colored bodies) contains
 * newlines and escapes, which wrap and corrupt the whole TUI frame.
 */
function summarizeErrorText(text: string, limit = MAX_ERROR_DETAIL): string {
  const flat = text
    .replace(ANSI_ESCAPE, '')
    // eslint-disable-next-line no-control-regex -- raw newlines/tabs from a body must become spaces.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length <= limit ? flat : flat.slice(0, limit).trimEnd();
}

/** True for markup (HTML/XML) bodies, which are never a JSON API answer. */
function looksLikeMarkup(text: string): boolean {
  return /^\s*</.test(text);
}

/** Builds the user-facing message for an HTML body masquerading as an API. */
function htmlInsteadOfJson(status: number): string {
  return `HTTP ${status}: server returned an HTML page instead of JSON — check the Base URL.`;
}

/** Message for a non-2xx response; its body is the server's own error payload. */
function describeFailedResponse(status: number, body: string): string {
  if (looksLikeMarkup(body)) return htmlInsteadOfJson(status);
  const detail = summarizeErrorText(body);
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

/** Message for a 2xx response whose body is not the OpenAI-style model list. */
function describeNonJsonBody(status: number, body: string): string {
  if (looksLikeMarkup(body)) return htmlInsteadOfJson(status);
  const detail = summarizeErrorText(body);
  return detail
    ? `HTTP ${status}: response is not JSON: ${detail}`
    : `HTTP ${status}: response is not JSON (empty body).`;
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Bound the amount of data read from an untrusted provider. */
async function readBody(res: Response): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Provider response exceeds the 4 MiB limit.');
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

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

  // A Cyrillic letter in the key (wrong keyboard layout) cannot be encoded into an
  // HTTP header: undici throws "Cannot convert argument to a ByteString…", which
  // says nothing about the actual mistake. Report it in terms the user can act on.
  const badKeyChar = findNonAsciiApiKeyChar(apiKey);
  if (badKeyChar) {
    return {
      ok: false,
      error: `API key has the non-ASCII character "${badKeyChar.char}" at position ${String(
        badKeyChar.index + 1,
      )} — check the keyboard layout.`,
    };
  }

  const url = baseUrl.replace(/\/$/, '') + '/models';
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: describeFailedResponse(res.status, await readBody(res)) };
    }

    const body = await readBody(res);
    if (controller.signal.aborted)
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, error: describeNonJsonBody(res.status, body) };
    }

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return {
        ok: false,
        error: 'Unexpected response format: expected an object with a "data" array.',
      };
    }

    if (!Array.isArray((json as { data?: unknown }).data)) {
      return {
        ok: false,
        error: 'Unexpected response format: expected an object with a "data" array.',
      };
    }
    const entries = (json as { data: Array<{ id?: unknown }> }).data;

    // Entries without a string id are ignored rather than crashing the form.
    const models = entries
      .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
      .filter(Boolean)
      .sort();

    return { ok: true, models };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: timedOut ? 'Request timed out.' : 'Request cancelled.' };
    }
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
    const detail = cause && !message.includes(cause) ? `${message} (${cause})` : message;
    return { ok: false, error: summarizeErrorText(detail) || 'Request failed.' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
