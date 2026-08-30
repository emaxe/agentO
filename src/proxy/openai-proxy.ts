import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  convertRequest,
  convertResponse,
  convertError,
  createStreamState,
  convertStreamChunk,
} from './openai-adapter.js';
import { buildProxyHeaders, getOutboundAgent, normalizeProxyUpstream } from './proxy-utils.js';

/** Options for starting the OpenAI-to-Anthropic proxy server. */
export interface OpenAIProxyOptions {
  upstreamUrl: string;
  port?: number;
  /** Milliseconds before destroying a stalled upstream request. Default: 120_000. */
  timeoutMs?: number;
}

/** Running proxy server handle. */
export interface ProxyServer {
  url: string;
  stop: () => Promise<void>;
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

/** Parse an SSE block (text between \n\n separators) into zero or more JSON events. */
function sseLineToEvent(block: string): Array<Record<string, unknown>> {
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6);
    if (payload === '[DONE]') return [];
    try {
      return [JSON.parse(payload)];
    } catch {
      return [];
    }
  }
  return [];
}

/** Start an HTTP proxy that translates Anthropic requests to OpenAI upstream. */
export async function startOpenAIProxy(options: OpenAIProxyOptions): Promise<ProxyServer> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const upstream = new URL(normalizeProxyUpstream(options.upstreamUrl));
  const upstreamModule = upstream.protocol === 'https:' ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? '/', 'http://localhost');
      const targetUrl = new URL(upstream);
      let upstreamPath = upstream.pathname.replace(/\/+$/, '');
      const reqPath = reqUrl.pathname;

      const isMessagesEndpoint = reqPath === '/v1/messages' || reqPath === '/v1/messages/';
      let resolvedPath = reqPath;
      if (isMessagesEndpoint) {
        resolvedPath = '/v1/chat/completions';
      }

      // Avoid double /v1 when upstream already ends with /v1 and resolvedPath starts with /v1/
      if (resolvedPath.startsWith('/v1/') && upstreamPath.endsWith('/v1')) {
        upstreamPath = upstreamPath.slice(0, -3);
      }

      targetUrl.pathname = upstreamPath + resolvedPath;
      targetUrl.search = reqUrl.search;

      let body: Buffer | undefined;
      const shouldRewrite = req.method === 'POST' && isJsonRequest(req) && isMessagesEndpoint;

      if (shouldRewrite) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw.toString('utf-8'));
            const converted = convertRequest(parsed);
            body = Buffer.from(JSON.stringify(converted), 'utf-8');
          } catch {
            body = raw;
          }
        }
      }

      const headers = buildProxyHeaders(req.headers, body?.length);

      const proxyReq = upstreamModule.request(
        targetUrl,
        { method: req.method, headers, agent: getOutboundAgent(upstream) },
        (proxyRes) => {
          const contentType = proxyRes.headers['content-type'];
          const ct = Array.isArray(contentType) ? contentType[0] : contentType;
          const isStream = typeof ct === 'string' && ct.includes('text/event-stream');
          const isJson = typeof ct === 'string' && ct.includes('application/json');

          if (
            isMessagesEndpoint &&
            (proxyRes.statusCode ?? 200) >= 200 &&
            (proxyRes.statusCode ?? 200) < 300
          ) {
            if (isStream) {
              const streamHeaders = { ...proxyRes.headers };
              delete streamHeaders['content-length'];
              delete streamHeaders['transfer-encoding'];
              res.writeHead(proxyRes.statusCode ?? 200, {
                ...streamHeaders,
                'content-type': 'text/event-stream',
              });
              const state = createStreamState('msg-proxy-' + Date.now(), 'unknown');
              let buffer = '';
              proxyRes.on('data', (chunk) => {
                buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
                const lines = buffer.split('\n\n');
                buffer = lines.pop() ?? '';
                for (const block of lines) {
                  const parsedEvents = sseLineToEvent(block);
                  for (const parsed of parsedEvents) {
                    const events = convertStreamChunk(parsed, state);
                    for (const ev of events) {
                      res.write(
                        `event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`,
                      );
                    }
                  }
                }
              });
              proxyRes.on('end', () => {
                if (buffer.trim()) {
                  const parsedEvents = sseLineToEvent(buffer);
                  for (const parsed of parsedEvents) {
                    const events = convertStreamChunk(parsed, state);
                    for (const ev of events) {
                      res.write(
                        `event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`,
                      );
                    }
                  }
                }
                res.end();
              });
              proxyRes.on('error', () => {
                if (!res.headersSent) {
                  res.writeHead(502);
                }
                res.end();
              });
              req.on('close', () => {
                if (!proxyRes.destroyed) proxyRes.destroy();
              });
            } else if (isJson) {
              const chunks: Buffer[] = [];
              proxyRes.on('data', (chunk) => {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
              });
              proxyRes.on('end', () => {
                try {
                  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                  const converted = convertResponse(parsed);
                  const out = Buffer.from(JSON.stringify(converted), 'utf-8');
                  const responseHeaders = { ...proxyRes.headers };
                  delete responseHeaders['transfer-encoding'];
                  res.writeHead(proxyRes.statusCode ?? 200, {
                    ...responseHeaders,
                    'content-length': out.length,
                  });
                  res.end(out);
                } catch {
                  res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                  res.end(Buffer.concat(chunks));
                }
              });
              proxyRes.on('error', (err) => {
                if (!res.headersSent) {
                  res.writeHead(502, { 'content-type': 'application/json' });
                }
                res.end(
                  JSON.stringify(convertError(err instanceof Error ? err.message : String(err))),
                );
              });
            } else {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
              proxyRes.pipe(res);
              proxyRes.on('error', () => {
                if (!res.headersSent) {
                  res.writeHead(502);
                }
                res.end();
              });
            }
          } else if (isMessagesEndpoint && isJson) {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk) => {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
            });
            proxyRes.on('end', () => {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                const converted = convertError(parsed);
                const out = Buffer.from(JSON.stringify(converted), 'utf-8');
                const responseHeaders = { ...proxyRes.headers };
                delete responseHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode ?? 200, {
                  ...responseHeaders,
                  'content-length': out.length,
                });
                res.end(out);
              } catch {
                res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                res.end(Buffer.concat(chunks));
              }
            });
            proxyRes.on('error', (err) => {
              if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'application/json' });
              }
              res.end(
                JSON.stringify(convertError(err instanceof Error ? err.message : String(err))),
              );
            });
          } else {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
            proxyRes.on('error', () => {
              if (!res.headersSent) {
                res.writeHead(502);
              }
              res.end();
            });
          }
        },
      );

      proxyReq.setTimeout(timeoutMs, () => {
        proxyReq.destroy(new Error('upstream timeout'));
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify(convertError({ error: { message: err.message, type: 'bad_gateway' } })),
          );
        }
      });

      req.on('error', () => {
        proxyReq.destroy();
      });

      if (body !== undefined) {
        proxyReq.end(body);
      } else {
        req.pipe(proxyReq);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify(convertError(err instanceof Error ? err.message : String(err))));
      }
    }
  });

  return new Promise<ProxyServer>((resolve, reject) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get proxy address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on('error', reject);
  });
}
