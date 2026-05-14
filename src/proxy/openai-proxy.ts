import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { convertRequest, convertResponse, convertError, createStreamState, convertStreamChunk } from './openai-adapter.js';

export interface OpenAIProxyOptions {
  upstreamUrl: string;
  port?: number;
}

export interface ProxyServer {
  url: string;
  stop: () => Promise<void>;
}

function buildProxyHeaders(
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

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
  }
  return Buffer.concat(chunks);
}

function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return typeof ct === 'string' && ct.includes('application/json');
}

function sseLineToEvent(line: string): Array<Record<string, unknown>> {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return [];
  const payload = trimmed.slice(6);
  if (payload === '[DONE]') return [];
  try {
    const parsed = JSON.parse(payload);
    return [parsed];
  } catch {
    return [];
  }
}

export async function startOpenAIProxy(options: OpenAIProxyOptions): Promise<ProxyServer> {
  const upstream = new URL(options.upstreamUrl);
  const upstreamModule = upstream.protocol === 'https:' ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? '/', 'http://localhost');
      const targetUrl = new URL(upstream);
      const upstreamPath = upstream.pathname.replace(/\/+$/, '');
      const reqPath = reqUrl.pathname;

      let resolvedPath = reqPath;
      if (reqPath === '/v1/messages') {
        resolvedPath = '/v1/chat/completions';
      }

      targetUrl.pathname = upstreamPath + resolvedPath;
      targetUrl.search = reqUrl.search;

      let body: Buffer | undefined;
      const shouldRewrite = req.method === 'POST' && isJsonRequest(req) && reqPath === '/v1/messages';

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
        { method: req.method, headers },
        (proxyRes) => {
          const isStream = proxyRes.headers['content-type']?.includes('text/event-stream');
          const isJson = proxyRes.headers['content-type']?.includes('application/json');
          const isMessagesEndpoint = reqPath === '/v1/messages';

          if (isMessagesEndpoint && (proxyRes.statusCode ?? 200) >= 200 && (proxyRes.statusCode ?? 200) < 300) {
            if (isStream) {
              res.writeHead(proxyRes.statusCode ?? 200, {
                ...proxyRes.headers,
                'content-type': 'text/event-stream',
              });
              const state = createStreamState('msg-proxy-' + Date.now(), 'unknown');
              let buffer = '';
              proxyRes.on('data', (chunk) => {
                buffer += (typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
                const lines = buffer.split('\n\n');
                buffer = lines.pop() ?? '';
                for (const block of lines) {
                  const parsedEvents = sseLineToEvent(block);
                  for (const parsed of parsedEvents) {
                    const events = convertStreamChunk(parsed, state);
                    for (const ev of events) {
                      res.write(`event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`);
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
                      res.write(`event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`);
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
            } else {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
              proxyRes.pipe(res);
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
          } else {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        },
      );

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify(convertError({ error: { message: err.message, type: 'bad_gateway' } })));
        }
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
