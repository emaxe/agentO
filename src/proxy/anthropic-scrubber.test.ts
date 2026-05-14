import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startAnthropicScrubberProxy, type ProxyServer } from './anthropic-scrubber.js';

describe('startAnthropicScrubberProxy', () => {
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
    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('transparently forwards GET requests', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ method: 'GET', url: '/v1/models' });
  });

  it('scrubs denied fields from POST JSON body', async () => {
    let receivedBody: unknown;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        context_management: { token_effort: 'high' },
        max_tokens: 1024,
      }),
    });

    expect(res.status).toBe(200);
    expect(receivedBody).toEqual({
      model: 'claude-3-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
    });
  });

  it('supports custom denyList', async () => {
    let receivedBody: unknown;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200);
      res.end('ok');
    });

    proxy = await startAnthropicScrubberProxy({
      upstreamUrl,
      denyList: ['custom_field'],
    });

    await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'test',
        custom_field: 'value',
        context_management: { token_effort: 'high' },
      }),
    });

    expect(receivedBody).toEqual({
      model: 'test',
      context_management: { token_effort: 'high' },
    });
  });

  it('passes through non-JSON POST unchanged', async () => {
    let receivedBody = Buffer.alloc(0);
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedBody = Buffer.concat(chunks);
      res.writeHead(200);
      res.end();
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    const body = 'raw-text-body';
    await fetch(`${proxy.url}/v1/other`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
    });

    expect(receivedBody.toString('utf-8')).toBe(body);
  });

  it('handles invalid JSON gracefully by passing body through', async () => {
    let receivedBody = Buffer.alloc(0);
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedBody = Buffer.concat(chunks);
      res.writeHead(200);
      res.end();
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    const body = '{invalid json}';
    await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(receivedBody.toString('utf-8')).toBe(body);
  });

  it('returns 502 when upstream is unreachable', async () => {
    proxy = await startAnthropicScrubberProxy({
      upstreamUrl: 'http://127.0.0.1:1', // no server here
    });

    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test' }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Bad Gateway');
  });

  it('streams upstream response without buffering', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => {
        res.write('data: second\n\n');
        res.end();
      }, 10);
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`);

    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader!.read();
      done = result.done;
      if (result.value) {
        chunks.push(new TextDecoder().decode(result.value));
      }
    }

    expect(chunks.join('')).toContain('data: first');
    expect(chunks.join('')).toContain('data: second');
  });

  it('recursively scrubs denied fields from nested objects', async () => {
    let receivedBody: unknown;
    upstream.on('request', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      res.writeHead(200);
      res.end('ok');
    });

    proxy = await startAnthropicScrubberProxy({ upstreamUrl });
    await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nested: {
          context_management: { nested: true },
          keep: 'value',
        },
        top: 'level',
      }),
    });

    expect(receivedBody).toEqual({
      nested: { keep: 'value' },
      top: 'level',
    });
  });

  it('preserves upstream base path when constructing target URL', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ receivedUrl: req.url }));
    });

    // upstream with a base path like Fireworks inference endpoint
    proxy = await startAnthropicScrubberProxy({
      upstreamUrl: `${upstreamUrl}/inference`,
    });

    const res = await fetch(`${proxy.url}/v1/messages`);
    expect(res.status).toBe(200);
    const body = await res.json() as { receivedUrl: string };
    expect(body.receivedUrl).toBe('/inference/v1/messages');
  });

  it('handles upstream base path with trailing slash', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ receivedUrl: req.url }));
    });

    proxy = await startAnthropicScrubberProxy({
      upstreamUrl: `${upstreamUrl}/api/`,
    });

    const res = await fetch(`${proxy.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json() as { receivedUrl: string };
    expect(body.receivedUrl).toBe('/api/v1/models');
  });

  it('preserves query parameters in target URL', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ receivedUrl: req.url }));
    });

    proxy = await startAnthropicScrubberProxy({
      upstreamUrl: `${upstreamUrl}/inference`,
    });

    const res = await fetch(`${proxy.url}/v1/messages?beta=true`);
    expect(res.status).toBe(200);
    const body = await res.json() as { receivedUrl: string };
    expect(body.receivedUrl).toBe('/inference/v1/messages?beta=true');
  });

  it('deduplicates /v1 when upstream already contains it', async () => {
    upstream.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ receivedUrl: req.url }));
    });

    proxy = await startAnthropicScrubberProxy({
      upstreamUrl: `${upstreamUrl}/inference/v1`,
    });

    const res = await fetch(`${proxy.url}/v1/messages`);
    expect(res.status).toBe(200);
    const body = await res.json() as { receivedUrl: string };
    expect(body.receivedUrl).toBe('/inference/v1/messages');
  });
});
