import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAnthropicScrubberProxy } from './anthropic-scrubber.js';
import { startOpenAIProxy } from './openai-proxy.js';
import { startResponsesProxy } from './responses-proxy.js';
import { stopServer } from './proxy-utils.js';

interface Stoppable {
  url: string;
  stop: () => Promise<void>;
}

const PROXIES: Array<[string, (upstreamUrl: string) => Promise<Stoppable>]> = [
  ['anthropic-scrubber', (upstreamUrl) => startAnthropicScrubberProxy({ upstreamUrl })],
  ['openai-proxy', (upstreamUrl) => startOpenAIProxy({ upstreamUrl })],
  ['responses-proxy', (upstreamUrl) => startResponsesProxy({ upstreamUrl })],
];

describe.each(PROXIES)('%s stop()', (_name, start) => {
  let upstream: http.Server;
  let upstreamUrl: string;
  let upstreamHit: Promise<void>;

  beforeEach(async () => {
    // An upstream that accepts the request and never answers: the proxy connection
    // stays busy, which is what blocks a plain `server.close()`.
    upstream = http.createServer();
    upstreamHit = new Promise<void>((resolve) => upstream.once('request', () => resolve()));
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const addr = upstream.address();
    if (!addr || typeof addr === 'string') throw new Error('Invalid upstream address');
    upstreamUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('resolves promptly while a request is still in flight', async () => {
    const proxy = await start(upstreamUrl);
    const inFlight = fetch(`${proxy.url}/v1/models`).catch(() => undefined);
    await upstreamHit;

    const started = Date.now();
    await proxy.stop();

    expect(Date.now() - started).toBeLessThan(2_500);
    await inFlight;
  });

  it('resolves promptly with an idle keep-alive connection open', async () => {
    const proxy = await start(upstreamUrl);
    const agent = new http.Agent({ keepAlive: true });
    try {
      const answered = http.get(`${proxy.url}/v1/models`, { agent });
      answered.on('error', () => undefined);
      await upstreamHit;

      const started = Date.now();
      await proxy.stop();
      expect(Date.now() - started).toBeLessThan(2_500);
    } finally {
      agent.destroy();
    }
  });
});

describe('stopServer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up after the timeout when the server never finishes closing', async () => {
    vi.useFakeTimers();
    const server = {
      close: vi.fn(),
      closeAllConnections: vi.fn(),
    } as unknown as http.Server;

    let resolved = false;
    const stopped = stopServer(server, 2_000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopped;

    expect(resolved).toBe(true);
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
  });

  it('resolves immediately once the server reports closed, without waiting for the timer', async () => {
    const server = {
      close: vi.fn((cb: () => void) => cb()),
      closeAllConnections: vi.fn(),
    } as unknown as http.Server;

    const started = Date.now();
    await stopServer(server, 10_000);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('works on runtimes without closeAllConnections', async () => {
    const server = { close: vi.fn((cb: () => void) => cb()) } as unknown as http.Server;
    await expect(stopServer(server, 10_000)).resolves.toBeUndefined();
  });
});
