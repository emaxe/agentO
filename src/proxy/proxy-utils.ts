import http from 'node:http';
import { URL } from 'node:url';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

const LOOPBACK = /^(127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}|localhost|\[::1\])$/i;

/**
 * Returns an HTTP(S) agent that routes through the system proxy when one is
 * configured, or `undefined` to use the default agent.
 *
 * For loopback upstreams, always returns `undefined` to avoid routing local
 * traffic through an external proxy.
 */
export function getOutboundAgent(upstream: URL): http.Agent | undefined {
  if (LOOPBACK.test(upstream.hostname)) return undefined;

  if (upstream.protocol === 'https:') {
    const url =
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy ??
      process.env.ALL_PROXY ??
      process.env.all_proxy;
    if (url) return new HttpsProxyAgent(url);
  } else {
    const url =
      process.env.HTTP_PROXY ??
      process.env.http_proxy ??
      process.env.ALL_PROXY ??
      process.env.all_proxy;
    if (url) return new HttpProxyAgent(url);
  }

  return undefined;
}

/**
 * Strips a trailing `/v1` or `/v1/` from a URL pathname.
 *
 * When a proxy later appends its own `/v1/...` path, this prevents
 * double `/v1/v1/...` segments.
 *
 * @example
 * normalizeProxyUpstream('https://api.fireworks.ai/inference/v1')
 * // => 'https://api.fireworks.ai/inference'
 */
export function normalizeProxyUpstream(url: string): string {
  const parsed = new URL(url);
  const cleaned = parsed.pathname.replace(/\/v1\/?$/, '');
  if (cleaned !== parsed.pathname) {
    parsed.pathname = cleaned;
  }
  return parsed.toString();
}

/**
 * Build outgoing proxy headers from an incoming request.
 *
 * Strips hop-by-hop headers (`host`, `content-length`, `transfer-encoding`)
 * and Anthropic-specific headers (`anthropic-version`).
 * Converts `x-api-key` to `Authorization: Bearer`.
 * Re-sets `content-length` from the (possibly rewritten) body length.
 */
export function buildProxyHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  bodyLength?: number,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'transfer-encoding') continue;
    if (lower === 'anthropic-version') continue;
    headers[key] = value;
  }
  const apiKey = incomingHeaders['x-api-key'];
  if (apiKey) {
    delete headers['x-api-key'];
    headers['authorization'] = `Bearer ${Array.isArray(apiKey) ? apiKey[0] : apiKey}`;
  }
  if (bodyLength !== undefined) {
    headers['content-length'] = bodyLength;
  }
  return headers;
}
