import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startOpenAIParamProxy, type ProxyServer } from './openai-param-proxy.js';

const MAX_TOKENS_UNSUPPORTED_MESSAGE =
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";

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
});
