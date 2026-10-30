import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startOpenAIParamProxy,
  shouldProxyModel,
  collectProxyUpstreams,
  responsesEndpointPath,
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

describe('responsesEndpointPath', () => {
  it('replaces the chat completions tail', () => {
    expect(responsesEndpointPath('/v1/chat/completions')).toBe('/v1/responses');
    expect(responsesEndpointPath('/api/v1/chat/completions/')).toBe('/api/v1/responses');
  });

  it('falls back to the sibling responses path', () => {
    expect(responsesEndpointPath('/v1/completions')).toBe('/v1/responses');
    expect(responsesEndpointPath('/chat/completions')).toBe('/responses');
  });
});

describe('chat completions to responses bridge', () => {
  let proxy: ProxyServer | undefined;
  let bridgeUpstream: http.Server;
  let bridgeUpstreamUrl: string;

  beforeEach(async () => {
    bridgeUpstream = http.createServer();
    await new Promise<void>((resolve) => bridgeUpstream.listen(0, '127.0.0.1', resolve));
    const addr = bridgeUpstream.address();
    if (!addr || typeof addr === 'string') throw new Error('Invalid upstream address');
    bridgeUpstreamUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await proxy?.stop();
    await new Promise<void>((resolve) => bridgeUpstream.close(() => resolve()));
  });

  const TOOL = {
    type: 'function',
    function: { name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } },
  };
  const TOOLS_ERROR = {
    error: {
      message:
        "Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
    },
  };
  const NONE_ERROR = {
    error: {
      message:
        "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'.",
    },
  };
  const SSE_BODY = [
    'event: response.created',
    'data: {"type":"response.created"}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","output_index":0,"delta":"hi"}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-6.1-sol","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5},"output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}]}}',
    '',
  ].join('\n');

  async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
  }

  function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  it('bridges to the responses endpoint when none is rejected', async () => {
    const bridgeBodies: Array<Record<string, unknown>> = [];
    bridgeUpstream.on('request', async (req, res) => {
      const body = await readJsonBody(req);
      if (req.url === '/v1/responses') {
        bridgeBodies.push(body);
        sendJson(res, 200, {
          id: 'resp_1',
          model: 'gpt-6.1-sol',
          status: 'completed',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
          ],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        });
        return;
      }
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
        temperature: 0.2,
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('hi');
    expect(body.usage.prompt_tokens).toBe(3);

    expect(bridgeBodies).toHaveLength(1);
    const bridgeBody = bridgeBodies[0];
    expect(bridgeBody.instructions).toBeUndefined();
    expect((bridgeBody.tools as any)[0]).toMatchObject({ type: 'function', name: 'ping' });
    expect(bridgeBody.reasoning).toBeUndefined();
    expect(bridgeBody.temperature).toBeUndefined();
  });

  it('bridges a streamed answer into chat chunks and ends with done', async () => {
    const bridgeBodies: Array<Record<string, unknown>> = [];
    bridgeUpstream.on('request', async (req, res) => {
      if (req.url === '/v1/responses') {
        bridgeBodies.push(await readJsonBody(req));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE_BODY);
        return;
      }
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
        stream: true,
      }),
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain('hi');
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
    expect(bridgeBodies[0].stream).toBe(true);
  });

  it('does not bridge a request without tools', async () => {
    let calls = 0;
    bridgeUpstream.on('request', async (_req, res) => {
      calls += 1;
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe(NONE_ERROR.error.message);
    expect(calls).toBe(1);
  });

  it('bridges only once', async () => {
    const urls: string[] = [];
    bridgeUpstream.on('request', async (req, res) => {
      urls.push(req.url ?? '');
      await readJsonBody(req);
      if (req.url === '/v1/responses') {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<html>nope</html>');
        return;
      }
      const chatCalls = urls.filter((url) => url === '/v1/chat/completions').length;
      sendJson(res, 400, chatCalls === 1 ? TOOLS_ERROR : NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'vendor-alpha-latest',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe(NONE_ERROR.error.message);
    expect(urls.filter((url) => url === '/v1/chat/completions')).toHaveLength(2);
    expect(urls.filter((url) => url === '/v1/responses')).toHaveLength(1);
  });

  it('returns the original 400 when the bridge endpoint is missing', async () => {
    bridgeUpstream.on('request', async (req, res) => {
      if (req.url === '/v1/responses') {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<html>nope</html>');
        return;
      }
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NONE_ERROR);
  });

  it('preserves the client reasoning effort through the bridge', async () => {
    const bridgeBodies: Array<Record<string, unknown>> = [];
    bridgeUpstream.on('request', async (req, res) => {
      if (req.url === '/v1/responses') {
        bridgeBodies.push(await readJsonBody(req));
        sendJson(res, 200, {
          id: 'resp_1',
          model: 'gpt-6.1-sol',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        });
        return;
      }
      sendJson(res, 400, TOOLS_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
        reasoning_effort: 'high',
      }),
    });

    expect(res.status).toBe(200);
    expect(bridgeBodies[0].reasoning).toEqual({ effort: 'high' });
  });

  it('surfaces a failed responses status as an error', async () => {
    bridgeUpstream.on('request', async (req, res) => {
      if (req.url === '/v1/responses') {
        sendJson(res, 200, {
          id: 'resp_1',
          status: 'failed',
          error: { message: 'model exploded' },
        });
        return;
      }
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
      }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe('model exploded');
  });

  it('forwards a bridge upstream failure', async () => {
    bridgeUpstream.on('request', async (req, res) => {
      if (req.url === '/v1/responses') {
        sendJson(res, 500, { error: { message: 'bridge down', type: 'api_error' } });
        return;
      }
      sendJson(res, 400, NONE_ERROR);
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const res = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
      }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error.message).toBe('bridge down');
  });

  it('tears down the bridge stream when the client aborts', async () => {
    const bridgeClosed = new Promise<boolean>((resolve) => {
      bridgeUpstream.on('request', (req, res) => {
        if (req.url === '/v1/responses') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"type":"response.created"}\n\n');
          res.on('close', () => resolve(!res.writableEnded));
          return;
        }
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(NONE_ERROR));
      });
    });

    proxy = await startOpenAIParamProxy({ upstreamUrl: bridgeUpstreamUrl });
    const clientReq = http.request(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    clientReq.end(
      JSON.stringify({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL],
        stream: true,
      }),
    );

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
        if (!aborted) reject(err);
      });
    });
    await withTimeout(clientAborted, 2000, 'client never received mid-stream data');

    const sawPrematureClose = await withTimeout(
      bridgeClosed,
      2000,
      'bridge upstream response was not closed after client abort',
    );
    expect(sawPrematureClose).toBe(true);
  });
});
