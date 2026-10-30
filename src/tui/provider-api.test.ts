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

  it('probes the openai-mode /v1 path for custom-api', () => {
    // The same shape resolveCustomApiUrl('openai') builds, because /models is an
    // OpenAI-style endpoint. Without this, a bare host probed /models instead of
    // /v1/models and the "Test API" row reported a bogus failure.
    expect(resolveModelsBaseUrl('custom-api', 'https://api.example.com')).toBe(
      'https://api.example.com/v1',
    );
    expect(resolveModelsBaseUrl('custom-api', 'https://api.example.com/')).toBe(
      'https://api.example.com/v1',
    );
  });

  it('keeps exactly one /v1 for a custom-api baseUrl that already ends in /v1', () => {
    expect(resolveModelsBaseUrl('custom-api', 'https://api.example.com/v1')).toBe(
      'https://api.example.com/v1',
    );
    expect(resolveModelsBaseUrl('custom-api', 'https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1',
    );
  });
});

describe('fetchProviderModels', () => {
  it('refuses to call without a base URL', async () => {
    const result = await fetchProviderModels('', 'sk-x');
    expect(result).toEqual({ ok: false, error: 'Base URL is required to test the API.' });
  });

  it('refuses a key with a non-ASCII character instead of letting fetch throw', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // "y" typed on the Russian layout is "н": the header cannot be encoded at all,
    // and undici's ByteString message tells the user nothing.
    const result = await fetchProviderModels('https://api.example.com/v1', 'or-proxy-keн');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: 'API key has the non-ASCII character "н" at position 12 — check the keyboard layout.',
    });
  });

  it('requests /models with a bearer token and returns sorted ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'mid' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProviderModels('https://api.example.com/v1', 'sk-secret');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      headers: { Authorization: 'Bearer sk-secret' },
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({ ok: true, models: ['alpha', 'mid', 'zeta'] });
  });

  it('does not double the slash when the base URL has a trailing one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchProviderModels('https://api.example.com/v1/', 'sk-x');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/models');
  });

  it('rejects a response with no data array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }),
    );
    expect(await fetchProviderModels('https://api.example.com/v1', 'sk-x')).toEqual({
      ok: false,
      error: 'Unexpected response format: expected an object with a "data" array.',
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
    expect(result).toEqual({ ok: false, error: 'Request cancelled.' });
  });

  it('times out a stalled request', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, options: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              options.signal.addEventListener(
                'abort',
                () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                { once: true },
              ),
            ),
        ),
      );
      const result = fetchProviderModels('https://api.example.com/v1', 'sk-x');
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await result).toEqual({ ok: false, error: 'Request timed out.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects responses larger than the size limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1))),
    );
    expect(await fetchProviderModels('https://api.example.com/v1', 'sk-x')).toEqual({
      ok: false,
      error: 'Provider response exceeds the 4 MiB limit.',
    });
  });

  it('explains an HTML page served with HTTP 200 instead of leaking a JSON parse error', async () => {
    // A wrong base URL or a proxy login page answers 200 with HTML.
    const html = '<!doctype html>\n<html>\n  <head><title>Sign in</title></head>\n</html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }),
    );

    const result = await fetchProviderModels('https://portal.example.com/v1', 'sk-x');

    expect(result.ok).toBe(false);
    const error = (result as { error: string }).error;
    expect(error).toContain('HTTP 200');
    expect(error).toContain('HTML');
    expect(error).toContain('Base URL');
    expect(error).not.toContain('SyntaxError');
    expect(error).not.toContain('<!doctype');
  });

  it('keeps a non-JSON 200 body on a single short line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'unauthorized\nplease\nretry',
      }),
    );

    const error = (await fetchProviderModels('https://api.example.com/v1', 'sk-x')) as {
      ok: false;
      error: string;
    };

    expect(error.ok).toBe(false);
    expect(error.error).toBe('HTTP 200: response is not JSON: unauthorized please retry');
  });

  it('rejects a JSON body that is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'null' }),
    );

    const result = await fetchProviderModels('https://api.example.com/v1', 'sk-x');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('Unexpected response format');
  });

  it('flattens a multi-line HTML error page from a failing request', async () => {
    // Ink renders this string inside a single terminal row; embedded newlines
    // (or raw markup) corrupt the whole frame.
    const html = '<!doctype html>\n<html>\n<body>\n<h1>502 Bad Gateway</h1>\n</body>\n</html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => html }),
    );

    const error = (await fetchProviderModels('https://api.example.com/v1', 'sk-x')) as {
      ok: false;
      error: string;
    };

    expect(error.error).toContain('HTTP 502');
    expect(error.error).toContain('HTML');
    expect(error.error).not.toContain('\n');
    expect(error.error).not.toContain('<!doctype');
  });

  it('strips ANSI escapes and newlines from a plain-text error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '\u001b[31mInvalid\r\nAPI key\u001b[0m',
      }),
    );

    const error = (await fetchProviderModels('https://api.example.com/v1', 'bad')) as {
      ok: false;
      error: string;
    };

    expect(error.error).toBe('HTTP 401: Invalid API key');
  });

  it('adds the underlying cause to a network failure', async () => {
    const failure = new TypeError('fetch failed', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:9'),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    const error = (await fetchProviderModels('https://api.example.com/v1', 'sk-x')) as {
      ok: false;
      error: string;
    };

    expect(error.error).toContain('fetch failed');
    expect(error.error).toContain('ECONNREFUSED');
  });
});
