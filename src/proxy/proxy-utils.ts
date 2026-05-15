import http from 'node:http';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

/**
 * Returns an HTTP(S) agent that tunnels outbound requests through the system
 * proxy configured via env vars. Returns undefined when:
 *   - no proxy env var is set
 *   - upstream host is a loopback address (127.x.x.x / localhost / ::1)
 *
 * Env var precedence (mirrors curl convention):
 *   HTTPS upstream: HTTPS_PROXY → https_proxy → HTTP_PROXY → http_proxy → ALL_PROXY → all_proxy
 *   HTTP upstream:  HTTP_PROXY  → http_proxy  → ALL_PROXY  → all_proxy
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
