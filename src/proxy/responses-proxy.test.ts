import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startResponsesProxy, type ProxyServer } from './responses-proxy.js';

describe('startResponsesProxy', () => {
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

  it('starts on a random port and returns a working url', async () => {
    proxy = await startResponsesProxy({ upstreamUrl });
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('forwards GET requests transparently', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ method: 'GET', url: '/v1/models' });
  });

  it('rewrites /v1/messages POST to /v1/responses and translates body', async () => {
    let receivedUrl = '';
    let receivedBody: unknown;
    upstream.on('request', async (req, res) => {
      receivedUrl = req.url ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_1',
          model: 'gpt-4o',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] },
          ],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      );
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      }),
    });
    expect(res.status).toBe(200);
    expect(receivedUrl).toBe('/v1/responses');
    const received = receivedBody as Record<string, unknown>;
    expect(received.max_output_tokens).toBe(100);
    expect(Array.isArray(received.input)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.content).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(body.stop_reason).toBe('end_turn');
  });

  it('translates streaming /v1/messages SSE response', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}\n\n',
      );
      res.write('data: {"type":"response.output_text.delta","output_index":0,"delta":"Hi"}\n\n');
      res.write('data: {"type":"response.output_item.done","output_index":0}\n\n');
      res.write(
        'data: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[]}],"usage":{"input_tokens":5,"output_tokens":1}}}\n\n',
      );
      res.end();
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: content_block_start');
    expect(text).toContain('event: content_block_delta');
    expect(text).toContain('event: content_block_stop');
    expect(text).toContain('event: message_delta');
    expect(text).toContain('event: message_stop');
  });

  it('removes anthropic-version and maps x-api-key to Authorization', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    upstream.on('request', (req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    await fetch(`${proxy.url}/v1/models`, {
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-secret' },
    });
    expect(receivedHeaders['anthropic-version']).toBeUndefined();
    expect(receivedHeaders['x-api-key']).toBeUndefined();
    expect(receivedHeaders['authorization']).toBe('Bearer sk-secret');
  });

  it('translates JSON errors from upstream', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Invalid model', type: 'invalid_request_error' } }),
      );
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'bad', messages: [], max_tokens: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe('error');
    expect((body.error as Record<string, unknown>).message).toBe('Invalid model');
  });

  it('passes through non-JSON upstream error body', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(502);
      res.end('Bad Gateway HTML');
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [], max_tokens: 1 }),
    });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('Bad Gateway HTML');
  });

  it('returns 502 when upstream times out', async () => {
    upstream.on('request', () => {
      /* hang */
    });
    proxy = await startResponsesProxy({ upstreamUrl, timeoutMs: 50 });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [], max_tokens: 1 }),
    });
    expect(res.status).toBe(502);
  });

  it('returns 502 when upstream is unreachable', async () => {
    proxy = await startResponsesProxy({ upstreamUrl: 'http://127.0.0.1:1' });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [], max_tokens: 1 }),
    });
    expect(res.status).toBe(502);
  });

  it('rewrites /v1/messages/ with trailing slash', async () => {
    let receivedUrl = '';
    upstream.on('request', (req, res) => {
      receivedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'r',
          model: 'm',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] },
          ],
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    await fetch(`${proxy.url}/v1/messages/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [], max_tokens: 1 }),
    });
    expect(receivedUrl).toBe('/v1/responses');
  });

  it('handles client disconnect mid-stream without crash', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}\n\n',
      );
      // leave hanging so client can abort
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const controller = new AbortController();
    try {
      const fetchProm = fetch(`${proxy.url}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 100,
          stream: true,
        }),
        signal: controller.signal,
      });
      controller.abort();
      await fetchProm;
    } catch {
      // AbortError is expected
    }
    // Verify proxy is still alive
    upstream.removeAllListeners('request');
    upstream.on('request', (_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const health = await fetch(`${proxy.url}/v1/models`);
    expect(health.status).toBe(200);
  });
});
