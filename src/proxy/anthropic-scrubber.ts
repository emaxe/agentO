import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { buildProxyHeaders, getOutboundAgent, normalizeProxyUpstream } from './proxy-utils.js';

export interface ProxyOptions {
  upstreamUrl: string;
  port?: number;
  denyList?: string[];
}

export interface ProxyServer {
  url: string;
  stop: () => Promise<void>;
}

const DEFAULT_DENYLIST = ['context_management'];

function scrubBody(value: unknown, denyList: Set<string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubBody(item, denyList));
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (!denyList.has(key)) {
      result[key] = scrubBody(val, denyList);
    }
  }
  return result;
}

function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return typeof ct === 'string' && ct.includes('application/json');
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function startAnthropicScrubberProxy(
  options: ProxyOptions,
): Promise<ProxyServer> {
  const denyList = new Set(options.denyList ?? DEFAULT_DENYLIST);
  const upstream = new URL(normalizeProxyUpstream(options.upstreamUrl));
  const upstreamModule = upstream.protocol === 'https:' ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? '/', 'http://localhost');
      const targetUrl = new URL(upstream);
      let upstreamPath = upstream.pathname.replace(/\/+$/, '');
      const reqPath = reqUrl.pathname;
      if (reqPath.startsWith('/v1/') && upstreamPath.endsWith('/v1')) {
        upstreamPath = upstreamPath.slice(0, -3);
      }
      targetUrl.pathname = upstreamPath + reqPath;
      targetUrl.search = reqUrl.search;

      let body: Buffer | undefined;
      const shouldScrub = req.method === 'POST' && isJsonRequest(req);

      if (shouldScrub) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw.toString('utf-8'));
            const scrubbed = scrubBody(parsed, denyList);
            body = Buffer.from(JSON.stringify(scrubbed), 'utf-8');
          } catch {
            body = raw;
          }
        }
      }

      const headers = buildProxyHeaders(req.headers, body?.length);

      const proxyReq = upstreamModule.request(
        targetUrl,
        {
          method: req.method,
          headers,
          agent: getOutboundAgent(upstream),
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
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
        res.end(
          JSON.stringify({
            error: 'Internal Server Error',
            message: err instanceof Error ? err.message : String(err),
          }),
        );
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
        stop: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
    server.on('error', reject);
  });
}
