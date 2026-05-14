import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startOpenAIProxy, type ProxyServer } from './openai-proxy.js';

describe('startOpenAIProxy', () => {
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
    proxy = await startOpenAIProxy({ upstreamUrl });
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('forwards GET requests transparently', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ method: 'GET', url: '/v1/models' });
  });

  it('rewrites and translates non-streaming /v1/messages', async () => {
    let receivedBody: unknown;
    upstream.on('request', async (req, res) => {
      expect(req.url).toBe('/v1/chat/completions');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-4',
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }));
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 100 }),
    });

    expect(res.status).toBe(200);
    expect(receivedBody).toEqual({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    });

    const body = await res.json();
    expect(body.content).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(body.stop_reason).toBe('end_turn');
  });

  it('translates streaming /v1/messages SSE', async () => {
    upstream.on('request', (req, res) => {
      expect(req.url).toBe('/v1/chat/completions');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 100, stream: true }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: content_block_start');
    expect(text).toContain('event: content_block_delta');
    expect(text).toContain('event: message_delta');
    expect(text).toContain('event: message_stop');
  });

  it('translates upstream JSON errors to Anthropic format', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid model', type: 'invalid_request_error' } }));
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [], max_tokens: 1 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.type).toBe('error');
    expect(body.error.message).toBe('Invalid model');
  });

  it('removes anthropic-version and maps x-api-key to Authorization', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    upstream.on('request', (req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    await fetch(`${proxy.url}/v1/models`, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': 'sk-secret',
      },
    });

    expect(receivedHeaders['anthropic-version']).toBeUndefined();
    expect(receivedHeaders['x-api-key']).toBeUndefined();
    expect(receivedHeaders['authorization']).toBe('Bearer sk-secret');
  });

  it('handles SSE events split across TCP chunks', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"c","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\ndata: {"id":"c","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n');
      res.write('data: {"id":"c","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 100, stream: true }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: message_stop');
  });

  it('maps x-api-key array to Authorization', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    upstream.on('request', (req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    await fetch(`${proxy.url}/v1/models`, {
      headers: {
        'x-api-key': 'sk-secret',
      },
    });
    expect(receivedHeaders['authorization']).toBe('Bearer sk-secret');
  });

  it('passes through non-JSON upstream error body unchanged', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(502);
      res.end('Bad Gateway HTML');
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [], max_tokens: 1 }),
    });

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe('Bad Gateway HTML');
  });

  it('rewrites /v1/messages/ with trailing slash', async () => {
    let receivedUrl = '';
    upstream.on('request', (req, res) => {
      receivedUrl = req.url ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', model: 'gpt-4', choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }));
    });

    proxy = await startOpenAIProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3', messages: [], max_tokens: 1 }),
    });

    expect(res.status).toBe(200);
    expect(receivedUrl).toBe('/v1/chat/completions');
  });
});
