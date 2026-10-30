import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  isMaxTokensUnsupportedError,
  requiresMaxCompletionTokens,
  withMaxCompletionTokens,
  type OpenAIRequest,
} from './openai-adapter.js';
import { getOutboundAgent, stopServer } from './proxy-utils.js';

/** Options for starting the OpenAI parameter pass-through proxy server. */
export interface ParamProxyOptions {
  upstreamUrl: string;
  /** Milliseconds before destroying a stalled upstream request. Default: 120_000. */
  timeoutMs?: number;
}

/** Running proxy server handle. */
export interface ProxyServer {
  url: string;
  stop: () => Promise<void>;
}

/** One launchable model entry considered for routing through the param proxy. */
export interface ProxyCandidate {
  model: string;
  baseUrl: string;
}

/**
 * Decide whether a model's traffic should route through the param proxy.
 *
 * A `(model, baseUrl)` pair qualifies when the model rejects `max_tokens`
 * (see `requiresMaxCompletionTokens`) or — for models the name heuristic
 * does not know — when it is served by OpenAI's own host (`api.openai.com`,
 * case-insensitive), where new families appear first and the proxy's
 * 400-retry safety net applies. Known legacy OpenAI families (gpt-N with
 * N < 5) still accept `max_tokens` and stay direct. Unparsable URLs cannot
 * be routed through the proxy and return false.
 * Pure function: no network, no server start, no filesystem access.
 */
export function shouldProxyModel(model: string, baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (requiresMaxCompletionTokens(model)) return true;
  if (host !== 'api.openai.com') return false;
  // Same name normalization as requiresMaxCompletionTokens: a known legacy
  // family (gpt-N, N < 5) accepts `max_tokens` and stays direct; anything
  // the heuristic does not recognize goes through the proxy.
  const name = model
    .slice(model.lastIndexOf('/') + 1)
    .trim()
    .toLowerCase();
  const gpt = /^gpt-(\d+)/.exec(name);
  return gpt === null || Number(gpt[1]) >= 5;
}

/**
 * Extract the distinct upstream base URLs that require the param proxy.
 *
 * Candidates are filtered with `shouldProxyModel` and deduplicated by the
 * exact `baseUrl` string, preserving first-seen order. Pure function.
 */
export function collectProxyUpstreams(candidates: ProxyCandidate[]): string[] {
  const seen = new Set<string>();
  const upstreams: string[] = [];
  for (const candidate of candidates) {
    if (!shouldProxyModel(candidate.model, candidate.baseUrl)) continue;
    if (seen.has(candidate.baseUrl)) continue;
    seen.add(candidate.baseUrl);
    upstreams.push(candidate.baseUrl);
  }
  return upstreams;
}

/** Read the full body of an incoming message into a Buffer. */
async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
  }
  return Buffer.concat(chunks);
}

/** Determine whether the incoming request has a JSON content type. */
function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return typeof ct === 'string' && ct.includes('application/json');
}

/**
 * Copy incoming headers for the upstream request, stripping only the
 * hop-by-hop framing headers (`host`, `content-length`, `transfer-encoding`).
 *
 * Unlike `buildProxyHeaders`, no `x-api-key` → `Authorization` rewrite (the
 * OpenAI SDK already sends `Authorization`) and no `accept-encoding: identity`
 * forcing (the response is piped through untouched, so upstream encodings must
 * reach the client unmodified).
 */
function copyForwardHeaders(incomingHeaders: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'transfer-encoding') continue;
    headers[key] = value;
  }
  return headers;
}

/**
 * Start a transparent HTTP proxy for OpenAI-shaped traffic that only rewrites
 * the `max_tokens` parameter.
 *
 * Newer OpenAI models (gpt-5+, o-series) reject `max_tokens` and require
 * `max_completion_tokens`; Qwen CLI hardcodes `max_tokens`. The proxy swaps
 * the parameter for JSON Chat Completions requests whose model needs it and
 * passes everything else through untouched:
 *
 * - The incoming path and query are forwarded verbatim (`targetUrl` is built
 *   from the upstream origin only), so a base URL that already includes the
 *   upstream path works without normalization.
 * - Only the request direction is inspected; responses stream through via
 *   `pipe` with their headers intact — except a 400, which is buffered solely
 *   to allow a single retry with `max_completion_tokens` when the upstream
 *   flags `max_tokens` as unsupported (for models the name heuristic does not
 *   know).
 * - Requests are never logged.
 */
export async function startOpenAIParamProxy(options: ParamProxyOptions): Promise<ProxyServer> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const upstream = new URL(options.upstreamUrl);
  const upstreamModule = upstream.protocol === 'https:' ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      // Keep the incoming path and query as-is; do not normalize or strip /v1.
      const targetUrl = new URL(req.url ?? '/', upstream.origin);
      const headers = copyForwardHeaders(req.headers);

      // Inspect the request body only: POST/PATCH/PUT with a JSON content type.
      let body: Buffer | undefined;
      let parsedRequest: OpenAIRequest | undefined;
      const shouldRewrite =
        (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') &&
        isJsonRequest(req);

      if (shouldRewrite) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw.toString('utf-8')) as OpenAIRequest;
            parsedRequest = parsed;
            if (requiresMaxCompletionTokens(String(parsed.model))) {
              body = Buffer.from(JSON.stringify(withMaxCompletionTokens(parsed)), 'utf-8');
            } else {
              body = raw;
            }
          } catch {
            // Parse failure: forward the raw bytes unchanged.
            body = raw;
          }
        }
      }

      if (body !== undefined) {
        // Body was consumed: re-state framing from the exact payload length
        // (rewritten length, or raw length which equals the original).
        headers['content-length'] = body.length;
      } else if (req.headers['content-length'] !== undefined) {
        // Body is piped through: keep the client's original framing.
        const cl = req.headers['content-length'];
        headers['content-length'] = Array.isArray(cl) ? cl[0] : cl;
      }

      let retriedMaxTokens = false;
      let activeRequest: http.ClientRequest | undefined;

      const sendUpstream = (payload: Buffer | undefined): void => {
        const proxyReq = upstreamModule.request(
          targetUrl,
          { method: req.method, headers, agent: getOutboundAgent(upstream) },
          (proxyRes) => {
            // The model-name heuristic can lag behind a new model family, so
            // the upstream 400 is the source of truth: retry once with
            // `max_completion_tokens`. Buffer the body only for a 400; every
            // other response is piped through untouched.
            if ((proxyRes.statusCode ?? 0) === 400) {
              const chunks: Buffer[] = [];
              proxyRes.on('data', (chunk) => {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
              });
              proxyRes.on('end', () => {
                const raw = Buffer.concat(chunks);
                let parsedBody: unknown;
                try {
                  parsedBody = JSON.parse(raw.toString('utf-8'));
                } catch {
                  parsedBody = undefined;
                }

                if (
                  !retriedMaxTokens &&
                  payload !== undefined &&
                  parsedBody !== undefined &&
                  parsedRequest !== undefined &&
                  isMaxTokensUnsupportedError(parsedBody)
                ) {
                  retriedMaxTokens = true;
                  const retryBody = Buffer.from(
                    JSON.stringify(withMaxCompletionTokens(parsedRequest)),
                    'utf-8',
                  );
                  // Rebuild content-length from the new body; all other
                  // forwarded headers stay as-is.
                  headers['content-length'] = retryBody.length;
                  sendUpstream(retryBody);
                  return;
                }

                // Not retrying: pass the 400 through verbatim.
                res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
                res.end(raw);
              });
              proxyRes.on('error', () => {
                if (!res.headersSent) {
                  res.writeHead(502, { 'content-type': 'application/json' });
                }
                res.end();
              });
              return;
            }

            // Response direction is untouched: status and content headers
            // (including SSE and compressed bodies) pass through verbatim.
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
            proxyRes.on('error', () => {
              if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'application/json' });
              }
              res.end();
            });
          },
        );

        activeRequest = proxyReq;

        proxyReq.setTimeout(timeoutMs, () => {
          proxyReq.destroy(new Error('upstream timeout'));
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: err.message, type: 'api_error' } }));
          } else {
            res.end();
          }
        });

        if (payload !== undefined) {
          proxyReq.end(payload);
        } else {
          req.pipe(proxyReq);
        }
      };

      req.on('error', () => {
        activeRequest?.destroy();
      });

      sendUpstream(body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'proxy failure', type: 'api_error' } }));
      }
    }
  });

  return new Promise<ProxyServer>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get proxy address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => stopServer(server),
      });
    });
    server.on('error', reject);
  });
}
