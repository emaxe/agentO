import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getOutboundAgent } from './proxy-utils.js';

const PROXY_URL = 'http://proxy.example.com:8080';

/** Save and restore proxy-related env vars around each test to avoid cross-test pollution. */
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const;

describe('getOutboundAgent', () => {
  let saved: Partial<Record<string, string>>;

  beforeEach(() => {
    saved = {};
    for (const key of PROXY_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PROXY_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  // no proxy configured
  it('returns undefined when no proxy env vars set', () => {
    const result = getOutboundAgent(new URL('https://api.openai.com'));
    expect(result).toBeUndefined();
  });

  // HTTPS upstream
  it('returns HttpsProxyAgent when HTTPS_PROXY set and upstream is https', () => {
    process.env.HTTPS_PROXY = PROXY_URL;
    const result = getOutboundAgent(new URL('https://api.openai.com'));
    expect(result).toBeInstanceOf(HttpsProxyAgent);
  });

  it('returns HttpsProxyAgent when HTTP_PROXY set and upstream is https (fallback)', () => {
    process.env.HTTP_PROXY = PROXY_URL;
    const result = getOutboundAgent(new URL('https://api.openai.com'));
    expect(result).toBeInstanceOf(HttpsProxyAgent);
  });

  it('returns HttpsProxyAgent when ALL_PROXY set and upstream is https', () => {
    process.env.ALL_PROXY = PROXY_URL;
    const result = getOutboundAgent(new URL('https://api.openai.com'));
    expect(result).toBeInstanceOf(HttpsProxyAgent);
  });

  it('HTTPS_PROXY takes precedence over HTTP_PROXY for https upstream', () => {
    const httpsProxyUrl = 'http://https-proxy.example.com:8080';
    process.env.HTTPS_PROXY = httpsProxyUrl;
    process.env.HTTP_PROXY = 'http://http-proxy.example.com:9090';
    const result = getOutboundAgent(new URL('https://api.openai.com'));
    expect(result).toBeInstanceOf(HttpsProxyAgent);
    // proxy url should be from HTTPS_PROXY
    expect((result as HttpsProxyAgent).proxy.href).toBe(new URL(httpsProxyUrl).href);
  });

  // HTTP upstream
  it('returns HttpProxyAgent when HTTP_PROXY set and upstream is http', () => {
    process.env.HTTP_PROXY = PROXY_URL;
    const result = getOutboundAgent(new URL('http://api.example.com'));
    expect(result).toBeInstanceOf(HttpProxyAgent);
  });

  it('returns HttpProxyAgent when ALL_PROXY set and upstream is http', () => {
    process.env.ALL_PROXY = PROXY_URL;
    const result = getOutboundAgent(new URL('http://api.example.com'));
    expect(result).toBeInstanceOf(HttpProxyAgent);
  });

  // loopback exclusion
  it('returns undefined for 127.0.0.1 even when HTTPS_PROXY set', () => {
    process.env.HTTPS_PROXY = PROXY_URL;
    expect(getOutboundAgent(new URL('https://127.0.0.1:8080'))).toBeUndefined();
  });

  it('returns undefined for localhost even when HTTPS_PROXY set', () => {
    process.env.HTTPS_PROXY = PROXY_URL;
    expect(getOutboundAgent(new URL('https://localhost:3000'))).toBeUndefined();
  });

  it('returns undefined for ::1 even when HTTPS_PROXY set', () => {
    process.env.HTTPS_PROXY = PROXY_URL;
    expect(getOutboundAgent(new URL('https://[::1]:3000'))).toBeUndefined();
  });

  it('returns undefined for 127.0.0.55 (any loopback) even when proxy set', () => {
    process.env.HTTPS_PROXY = PROXY_URL;
    expect(getOutboundAgent(new URL('https://127.0.0.55:443'))).toBeUndefined();
  });
});
