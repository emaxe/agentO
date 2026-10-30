import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  gptMajorVersion,
  isMaxTokensUnsupportedError,
  isReasoningEffortValueUnsupportedError,
  isToolsReasoningUnsupportedError,
  requiresMaxCompletionTokens,
  withMaxCompletionTokens,
  withReasoningDisabledForTools,
  type OpenAIRequest,
} from './openai-adapter.js';
import {
  chatCompletionToStreamChunks,
  convertChatRequestToResponses,
  convertResponsesEventToChatChunks,
  convertResponsesToChatResponse,
  createChatStreamState,
  type ChatRequest,
  responsesSseToChatResponse,
} from './chat-responses-adapter.js';
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
  // A known legacy family (gpt-N, N < 5) accepts `max_tokens` and stays
  // direct; anything the heuristic does not recognize goes through the proxy.
  const major = gptMajorVersion(model);
  return major === undefined || major >= 5;
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

/** Type guard for plain objects. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Parse the JSON `data:` lines of one SSE block. */
function parseSseBlock(block: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6);
    if (payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      if (isRecord(parsed)) events.push(parsed);
    } catch {
      // Ignore malformed frames.
    }
  }
  return events;
}

/** Derive the Responses endpoint from the incoming Chat Completions path. */
export function responsesEndpointPath(requestPath: string): string {
  const trimmed = requestPath.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length) + '/responses';
  }
  const slash = trimmed.lastIndexOf('/');
  const dir = slash <= 0 ? '' : trimmed.slice(0, slash);
  return dir + '/responses';
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
 * OpenAI SDK already sends `Authorization`). `accept-encoding` is forced to
 * `identity` because the proxy buffers 400 bodies to inspect them for a
 * retry: a compressed error body would silently defeat every detector.
 */
function copyForwardHeaders(incomingHeaders: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'transfer-encoding') continue;
    headers[key] = value;
  }
  headers['accept-encoding'] = 'identity';
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
      let parsedRequest: ChatRequest | undefined;
      let originalReasoningEffort: string | undefined;
      const shouldRewrite =
        (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') &&
        isJsonRequest(req);

      if (shouldRewrite) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw.toString('utf-8')) as ChatRequest;
            parsedRequest = parsed;
            originalReasoningEffort = parsed.reasoning_effort;
            let rewritten = parsed;
            if (requiresMaxCompletionTokens(String(parsed.model))) {
              rewritten = withMaxCompletionTokens(rewritten);
            }
            rewritten = withReasoningDisabledForTools(rewritten);
            body = rewritten === parsed ? raw : Buffer.from(JSON.stringify(rewritten), 'utf-8');
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
      let retriedToolsReasoning = false;
      let bridged = false;
      let activeRequest: http.ClientRequest | undefined;

      /**
       * Replay the request against the upstream Responses endpoint and translate
       * the answer back into Chat Completions.
       *
       * Used once, only after the upstream proved that `/v1/chat/completions`
       * cannot serve this request: reasoning-only models (`gpt-6.1-sol`,
       * `gpt-6-astra`) refuse function tools no matter what `reasoning_effort`
       * is set to. Framing follows the client's `stream` flag, not the upstream
       * content type, and a failed Responses answer is surfaced as an error
       * rather than an empty completion.
       */
      const sendViaBridge = (request: ChatRequest, originalBody: Buffer): void => {
        const bridgeBody = Buffer.from(
          JSON.stringify(convertChatRequestToResponses(request, { originalReasoningEffort })),
          'utf-8',
        );
        const bridgeUrl = new URL(
          responsesEndpointPath(targetUrl.pathname) + targetUrl.search,
          upstream.origin,
        );
        const bridgeHeaders: http.OutgoingHttpHeaders = {
          ...headers,
          'content-length': bridgeBody.length,
          'accept-encoding': 'identity',
        };
        const wantsStream = request.stream === true;
        const model = String(request.model ?? '');

        const replyJson = (status: number, payload: unknown): void => {
          if (res.writableEnded) return;
          const out = Buffer.from(JSON.stringify(payload), 'utf-8');
          if (!res.headersSent) {
            res.writeHead(status, {
              'content-type': 'application/json',
              'content-length': out.length,
            });
          }
          res.end(out);
        };
        const replyFailed = (message: string): void => {
          replyJson(502, { error: { message, type: 'api_error' } });
        };

        const bridgeReq = upstreamModule.request(
          bridgeUrl,
          { method: 'POST', headers: bridgeHeaders, agent: getOutboundAgent(upstream) },
          (bridgeRes) => {
            const status = bridgeRes.statusCode ?? 502;
            const rawContentType = bridgeRes.headers['content-type'];
            const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
            const isSse =
              typeof contentType === 'string' && contentType.includes('text/event-stream');

            if (status < 200 || status >= 300) {
              const chunks: Buffer[] = [];
              bridgeRes.on('data', (chunk) => {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
              });
              bridgeRes.on('end', () => {
                const rawError = Buffer.concat(chunks);
                let hasError = false;
                try {
                  const parsed = JSON.parse(rawError.toString('utf-8'));
                  hasError =
                    isRecord(parsed) && parsed.error !== undefined && parsed.error !== null;
                } catch {
                  hasError = false;
                }
                if (hasError) {
                  if (res.writableEnded) return;
                  res.writeHead(status, {
                    'content-type': 'application/json',
                    'content-length': rawError.length,
                  });
                  res.end(rawError);
                  return;
                }
                // Opaque bridge failure (missing endpoint, HTML page): the original
                // Chat Completions 400 still names the real reason and the
                // /v1/responses hint, so it is more useful than a bare 404.
                if (res.writableEnded) return;
                res.writeHead(400, {
                  'content-type': 'application/json',
                  'content-length': originalBody.length,
                });
                res.end(originalBody);
              });
              bridgeRes.on('error', () => replyFailed('responses bridge failed'));
              return;
            }

            if (isSse) {
              let buffer = '';
              const events: Array<Record<string, unknown>> = [];
              const chunkState = createChatStreamState(
                'chatcmpl-' + Date.now(),
                model,
                Math.floor(Date.now() / 1000),
              );
              if (wantsStream) {
                const streamHeaders = { ...bridgeRes.headers };
                delete streamHeaders['content-length'];
                delete streamHeaders['transfer-encoding'];
                res.writeHead(200, { ...streamHeaders, 'content-type': 'text/event-stream' });
                res.on('close', () => {
                  if (!res.writableEnded && !bridgeRes.destroyed) bridgeRes.destroy();
                });
              }
              const emit = (event: Record<string, unknown>): void => {
                if (!wantsStream) {
                  events.push(event);
                  return;
                }
                for (const chunk of convertResponsesEventToChatChunks(event, chunkState)) {
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
              };
              bridgeRes.on('data', (chunk) => {
                buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop() ?? '';
                for (const block of blocks) {
                  for (const event of parseSseBlock(block)) emit(event);
                }
              });
              bridgeRes.on('end', () => {
                if (buffer.trim()) {
                  for (const event of parseSseBlock(buffer)) emit(event);
                }
                if (wantsStream) {
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }
                replyJson(200, responsesSseToChatResponse(events, model));
              });
              bridgeRes.on('error', () => replyFailed('responses bridge stream failed'));
              return;
            }

            const chunks: Buffer[] = [];
            bridgeRes.on('data', (chunk) => {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
            });
            bridgeRes.on('end', () => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              } catch {
                replyFailed('responses bridge returned an invalid body');
                return;
              }
              const response = isRecord(parsed) ? parsed : {};
              const error = isRecord(response.error) ? response.error : undefined;
              if (response.status === 'failed' || error !== undefined) {
                replyFailed(String(error?.message ?? 'responses bridge: request failed'));
                return;
              }
              const completion = convertResponsesToChatResponse(response, model);
              if (wantsStream) {
                if (res.writableEnded) return;
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                for (const chunk of chatCompletionToStreamChunks(completion)) {
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              const out = Buffer.from(JSON.stringify(completion), 'utf-8');
              if (res.writableEnded) return;
              res.writeHead(status, {
                'content-type': 'application/json',
                'content-length': out.length,
              });
              res.end(out);
            });
            bridgeRes.on('error', () => replyFailed('responses bridge failed'));
          },
        );

        activeRequest = bridgeReq;
        bridgeReq.setTimeout(timeoutMs, () => bridgeReq.destroy(new Error('upstream timeout')));
        bridgeReq.on('error', (err) => {
          replyFailed(err.message);
        });
        bridgeReq.end(bridgeBody);
      };

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
                  parsedRequest.max_tokens !== undefined &&
                  isMaxTokensUnsupportedError(parsedBody)
                ) {
                  retriedMaxTokens = true;
                  parsedRequest = withMaxCompletionTokens(parsedRequest);
                  const retryBody = Buffer.from(JSON.stringify(parsedRequest), 'utf-8');
                  // Rebuild content-length from the new body; all other
                  // forwarded headers stay as-is.
                  headers['content-length'] = retryBody.length;
                  sendUpstream(retryBody);
                  return;
                }

                if (
                  !retriedToolsReasoning &&
                  parsedBody !== undefined &&
                  parsedRequest !== undefined &&
                  parsedRequest.reasoning_effort !== 'none' &&
                  isToolsReasoningUnsupportedError(parsedBody)
                ) {
                  retriedToolsReasoning = true;
                  parsedRequest = { ...parsedRequest, reasoning_effort: 'none' };
                  const retryBody = Buffer.from(JSON.stringify(parsedRequest), 'utf-8');
                  headers['content-length'] = retryBody.length;
                  sendUpstream(retryBody);
                  return;
                }

                // The upstream proved Chat Completions cannot serve tools for
                // this model (reasoning-only families). Replay through the
                // Responses API once.
                if (
                  !bridged &&
                  parsedRequest !== undefined &&
                  parsedBody !== undefined &&
                  Array.isArray(parsedRequest.tools) &&
                  parsedRequest.tools.length > 0 &&
                  (isToolsReasoningUnsupportedError(parsedBody) ||
                    isReasoningEffortValueUnsupportedError(parsedBody))
                ) {
                  bridged = true;
                  sendViaBridge(parsedRequest, raw);
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
            // If the client aborts mid-stream, the request body was already
            // consumed for JSON POSTs and `req` already emitted its `close`
            // at message completion, so it will not re-emit; `res` instead
            // emits `close` with the response unfinished. Destroy the
            // upstream response so a mid-stream abort (Ctrl-C) does not let
            // the paid upstream request run to completion. `writableEnded`
            // keeps normally completed responses from tearing down the
            // upstream connection.
            res.on('close', () => {
              if (!res.writableEnded && !proxyRes.destroyed) proxyRes.destroy();
            });
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
