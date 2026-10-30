import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startOpenAIParamProxy,
  shouldProxyModel,
  collectProxyUpstreams,
  type ProxyServer,
} from './openai-param-proxy.js';

const MAX_TOKENS_UNSUPPORTED_MESSAGE =
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";

/** Waits for `promise` but fails after `ms` with `message` to keep tests bounded. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('startOpenAIParamProxy', () => {
  let proxy: ProxyServer | undefined;
  let upstream: http.Server;
  let upstreamUrl: string;

  beforeEach(async () => {
    upstream = http.createServer();
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address();
    if (!addr || typeof addr === 'string') throw new Error('Invalid upstream address');
    upstreamUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await proxy?.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('forwards method, path and query verbatim', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ method: 'POST', url: '/api/v1/chat/completions?x=1' });
  });

  it('passes GET requests and non-JSON bodies through untouched', async () => {
    upstream.on('request', async (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('get-ok');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      const raw = Buffer.concat(chunks);
      const ct = req.headers['content-type'] ?? 'text/plain';
      res.writeHead(200, { 'content-type': Array.isArray(ct) ? ct[0] : ct });
      res.end(raw);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });

    const getRes = await fetch(`${proxy.url}/api/v1/models`);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe('get-ok');

    const payload = 'raw text body ☂ — definitely not JSON';
    const postRes = await fetch(`${proxy.url}/api/v1/upload?a=b`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: payload,
    });
    expect(postRes.status).toBe(200);
    const received = Buffer.from(await postRes.arrayBuffer());
    expect(received.equals(Buffer.from(payload, 'utf-8'))).toBe(true);
  });

  it('keeps max_tokens for models that accept it', async () => {
    let received: Record<string, unknown> | undefined;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      received = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(received).toMatchObject({ model: 'gpt-4.1', max_tokens: 100 });
    expect(received).not.toHaveProperty('max_completion_tokens');
  });

  it('swaps max_tokens for max_completion_tokens when the model requires it', async () => {
    let received: Record<string, unknown> | undefined;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      received = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(received).toMatchObject({ model: 'gpt-6.1-terra', max_completion_tokens: 100 });
    expect(received).not.toHaveProperty('max_tokens');
  });

  it('streams SSE responses without buffering or rewriting', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // First write: complete first event + incomplete second event (no trailing \n\n)
      res.write(
        'data: {"id":"c","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\ndata: {"id":"c","choices":[{"delta":{"content":"Hi',
      );
      // Second write: completes the second event
      res.write('"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"c","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {"id":"c","choices":[{"delta":{"role":"assistant"}');
    expect(text).toContain('"delta":{"content":"Hi"},"finish_reason":null}');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('retries once with max_completion_tokens when the upstream rejects max_tokens', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>);
      if (bodies.length === 1) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: MAX_TOKENS_UNSUPPORTED_MESSAGE } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'vendor-alpha-latest',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      }),
    });

    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ model: 'vendor-alpha-latest', max_tokens: 100 });
    expect(bodies[1]).toMatchObject({ model: 'vendor-alpha-latest', max_completion_tokens: 100 });
    expect(bodies[1]).not.toHaveProperty('max_tokens');
  });

  it('does not retry a second time when the retried request is also rejected', async () => {
    let calls = 0;
    upstream.on('request', async (req, res) => {
      calls += 1;
      const drained: Buffer[] = [];
      for await (const chunk of req)
        drained.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      void drained;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: MAX_TOKENS_UNSUPPORTED_MESSAGE } }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'vendor-alpha-latest',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: MAX_TOKENS_UNSUPPORTED_MESSAGE } });
    expect(calls).toBe(2);
  });

  it('does not retry a matching 400 when the request body has no max_tokens', async () => {
    let calls = 0;
    upstream.on('request', async (req, res) => {
      calls += 1;
      const drained: Buffer[] = [];
      for await (const chunk of req)
        drained.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      void drained;
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: MAX_TOKENS_UNSUPPORTED_MESSAGE } }));
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Without max_tokens the retry would resend an identical, equally
      // doomed body: the gate must not fire at all.
      body: JSON.stringify({
        model: 'vendor-alpha-latest',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { message: MAX_TOKENS_UNSUPPORTED_MESSAGE } });
    expect(calls).toBe(1);
  });

  it('closes the upstream response when the client aborts mid-stream', async () => {
    // Upstream leaves the SSE stream hanging; it must observe a premature
    // close (its response socket torn down by the proxy) once the client
    // aborts, instead of running the paid request to completion.
    const upstreamClosed = new Promise<boolean>((resolve) => {
      upstream.on('request', (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"id":"c"}\n\n');
        // Leave hanging so the client can abort mid-stream.
        res.on('close', () => resolve(!res.writableEnded));
      });
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const clientReq = http.request(`${proxy.url}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    clientReq.end(
      JSON.stringify({
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        stream: true,
      }),
    );

    // Abort once the first chunk has crossed the proxy pipe: by then the
    // proxy's close guard is armed (registered synchronously with `pipe`).
    let aborted = false;
    const clientAborted = new Promise<void>((resolve, reject) => {
      clientReq.on('response', (clientRes) => {
        clientRes.on('data', () => {
          if (aborted) return;
          aborted = true;
          clientRes.destroy();
          clientReq.destroy();
          resolve();
        });
      });
      clientReq.on('error', (err) => {
        // Errors after the intentional destroy are expected side effects;
        // anything before means the client never started streaming.
        if (!aborted) reject(err);
      });
    });
    await withTimeout(clientAborted, 2000, 'client never received mid-stream data');

    const sawPrematureClose = await withTimeout(
      upstreamClosed,
      2000,
      'upstream response was not closed after client abort',
    );
    expect(sawPrematureClose).toBe(true);
  });

  it('disables reasoning for function tools on gpt-6 models', async () => {
    let receivedBody: Record<string, unknown> = {};
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ id: 'x', choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      );
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-terra',
        messages: [{ role: 'user', content: 'time?' }],
        tools: [{ type: 'function', function: { name: 'get_time' } }],
      }),
    });

    expect(res.status).toBe(200);
    expect(receivedBody.reasoning_effort).toBe('none');
  });

  it('keeps reasoning with tools on gpt-5 models', async () => {
    let receivedBody: Record<string, unknown> = {};
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ id: 'x', choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      );
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: 'time?' }],
        tools: [{ type: 'function', function: { name: 'get_time' } }],
      }),
    });

    expect(res.status).toBe(200);
    expect(receivedBody.reasoning_effort).toBeUndefined();
  });

  it('retries once with reasoning_effort none when tools are rejected', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req)
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      calls += 1;
      if (calls === 1) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message:
                "Function tools with reasoning_effort are not supported for some-model in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
            },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ id: 'x', choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
      );
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'vendor-alpha-latest',
        messages: [{ role: 'user', content: 'time?' }],
        tools: [{ type: 'function', function: { name: 'get_time' } }],
      }),
    });

    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reasoning_effort).toBeUndefined();
    expect(bodies[1].reasoning_effort).toBe('none');
  });
});

describe('proxy routing helpers', () => {
  it('proxies models that require max_completion_tokens', () => {
    expect(shouldProxyModel('gpt-6.1-terra', 'https://example.com/v1')).toBe(true);
    expect(shouldProxyModel('o3-mini', 'https://example.com/v1')).toBe(true);
  });

  it('proxies any model served by api.openai.com, including unknown families', () => {
    expect(shouldProxyModel('gpt-7-future', 'https://api.openai.com/v1')).toBe(true);
    // Not classified by the name heuristic (no o-series / gpt-N prefix):
    // this pins the api.openai.com host branch itself.
    expect(shouldProxyModel('some-unknown-family', 'https://api.openai.com/v1')).toBe(true);
  });

  it('leaves other providers and legacy models direct', () => {
    expect(shouldProxyModel('gpt-4.1', 'https://api.openai.com/v1')).toBe(false);
    expect(shouldProxyModel('qwen3.8-max', 'https://dashscope.example.com/v1')).toBe(false);
    expect(shouldProxyModel('deepseek-v4-pro', 'https://ollama.com/v1')).toBe(false);
    expect(shouldProxyModel('gpt-6', 'not a url')).toBe(false);
  });

  it('deduplicates upstreams and keeps only qualifying ones', () => {
    const upstreams = collectProxyUpstreams([
      { model: 'gpt-6.1-terra', baseUrl: 'https://api.openai.com/v1' },
      { model: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1' },
      { model: 'qwen3.8-max', baseUrl: 'https://dashscope.example.com/v1' },
    ]);
    expect(upstreams).toEqual(['https://api.openai.com/v1']);
  });
});
