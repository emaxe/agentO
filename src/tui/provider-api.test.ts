/**
 * The provider form's "Test API" / "Fetch models" path — previously untested,
 * and the only place in the TUI that talks to the network.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProviderModels, isOpenAICompatible, resolveModelsBaseUrl } from './provider-api.js';
import { PROVIDER_TYPES } from '../config/schema.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isOpenAICompatible', () => {
  it('accepts the types that expose /v1/models', () => {
    expect(isOpenAICompatible('openai-compatible')).toBe(true);
    expect(isOpenAICompatible('fireworks')).toBe(true);
    expect(isOpenAICompatible('openrouter')).toBe(true);
    expect(isOpenAICompatible('custom-api')).toBe(true);
  });

  it('rejects the ones that do not', () => {
    expect(isOpenAICompatible('anthropic-compatible')).toBe(false);
    expect(isOpenAICompatible('responses-compatible')).toBe(false);
  });

  it('has an answer for every provider type', () => {
    for (const type of PROVIDER_TYPES) {
      expect(typeof isOpenAICompatible(type)).toBe('boolean');
    }
  });
});

describe('resolveModelsBaseUrl', () => {
  it('prefers what the user typed', () => {
    expect(resolveModelsBaseUrl('fireworks', 'https://mine.example.com/v1')).toBe(
      'https://mine.example.com/v1',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveModelsBaseUrl('fireworks', '  https://mine.example.com/v1  ')).toBe(
      'https://mine.example.com/v1',
    );
  });

  it('falls back to the type default when the field is blank', () => {
    expect(resolveModelsBaseUrl('openai-compatible', '')).toBe('https://api.openai.com/v1');
    expect(resolveModelsBaseUrl('fireworks', '   ')).toBe('https://api.fireworks.ai/inference/v1');
  });

  it('returns an empty string for a type with no default', () => {
    // custom-api has no universal endpoint, so the form must require one.
    expect(resolveModelsBaseUrl('custom-api', '')).toBe('');
  });
});

describe('fetchProviderModels', () => {
  it('refuses to call without a base URL', async () => {
    const result = await fetchProviderModels('', 'sk-x');
    expect(result).toEqual({ ok: false, error: 'Base URL is required to test the API.' });
  });

  it('requests /models with a bearer token and returns sorted ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'mid' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProviderModels('https://api.example.com/v1', 'sk-secret');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      headers: { Authorization: 'Bearer sk-secret' },
      signal: undefined,
    });
    expect(result).toEqual({ ok: true, models: ['alpha', 'mid', 'zeta'] });
  });

  it('does not double the slash when the base URL has a trailing one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchProviderModels('https://api.example.com/v1/', 'sk-x');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/models');
  });

  it('tolerates a response with no data array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await fetchProviderModels('https://api.example.com/v1', 'sk-x')).toEqual({
      ok: true,
      models: [],
    });
  });

  it('surfaces an HTTP error with a truncated body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'x'.repeat(500),
      }),
    );

    const result = await fetchProviderModels('https://api.example.com/v1', 'bad');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/^HTTP 401: x{200}$/);
  });

  it('reports a network failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await fetchProviderModels('https://api.example.com/v1', 'sk-x');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('ECONNREFUSED');
  });

  it('distinguishes an aborted request', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    const result = await fetchProviderModels('https://api.example.com/v1', 'sk-x');
    expect(result).toEqual({ ok: false, error: 'Запрос отменён.' });
  });
});
