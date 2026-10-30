# Qwen Parameter Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Qwen CLI work with OpenAI models that reject `max_tokens` by routing those models through a local pass-through proxy that swaps the parameter to `max_completion_tokens`.

**Architecture:** A new HTTP proxy forwards OpenAI Chat Completions requests verbatim to the real upstream, rewriting only the output-token parameter in JSON bodies and retrying once when an unrecognised model still rejects `max_tokens`. `maybeStartProxy()` in the launch transaction starts one proxy per qualifying upstream, points the qualifying Qwen model entries at `127.0.0.1`, and stops the proxies during cleanup.

**Tech Stack:** TypeScript 5.5, Node.js `http`/`https`, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-qwen-param-proxy-design.md`

## Global Constraints

- No new npm dependencies; use `node:http`, `node:https`, `node:url`.
- Proxy listens only on `127.0.0.1` with a random port (`port ?? 0`).
- Reuse `getOutboundAgent`, `buildProxyHeaders`-style header hygiene and `stopServer` from `src/proxy/proxy-utils.ts`.
- Never log request bodies, prompts or API keys.
- Only models whose name needs `max_completion_tokens` or whose upstream host is `api.openai.com` are proxied; all other Qwen traffic keeps its direct `baseUrl`.
- Keep the API key path unchanged: rewrite `baseUrl` only, never `envKey`, `id`, `name` or `generationConfig`.
- Tests must not depend on POSIX-only behaviour; upstreams are local `http://127.0.0.1:<port>` servers.
- After the code lands, `npm run build` must be run (`dist/` is what the global `agento` executes).

## Review Focus

1. **Upstream base URL with a custom path** (`https://openrouter.ai/api/v1`) — the agent appends `/chat/completions` to `baseUrl`; the proxy must preserve `/api/v1` instead of flattening it to the origin. Pinned in Task 1 and Task 4.
2. **Streaming responses** — Qwen streams by default; SSE bytes must pass through unbuffered and unmodified. Pinned in Task 1.
3. **Credential lookup** — Qwen resolves the key through `envKey`, which AgentO derives from the *real* base URL; rewriting it breaks authentication. Pinned in Task 4.
4. **Mixed profiles** — a profile with several upstreams must start one proxy per distinct upstream and stop all of them on cleanup. Pinned in Task 4.
5. **Proxy start failure** — a launch must fail before the agent spawns rather than silently sending `max_tokens` again. Pinned in Task 4.

---

### Task 1: Pass-through proxy with parameter rewrite

**Files:**
- Create: `src/proxy/openai-param-proxy.ts`
- Test: `src/proxy/openai-param-proxy.test.ts`

**Interfaces:**
- Consumes: `requiresMaxCompletionTokens`, `withMaxCompletionTokens` and `OpenAIRequest` from `src/proxy/openai-adapter.ts`; `getOutboundAgent`, `stopServer` from `src/proxy/proxy-utils.ts`.
- Produces:
  ```ts
  export interface ParamProxyOptions { upstreamUrl: string; timeoutMs?: number }
  export interface ProxyServer { url: string; stop: () => Promise<void> }
  export async function startOpenAIParamProxy(options: ParamProxyOptions): Promise<ProxyServer>
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/proxy/openai-param-proxy.test.ts` following the `beforeEach`/`afterEach` upstream-server pattern in `src/proxy/openai-proxy.test.ts`. Tests:

```ts
it('forwards method, path and query verbatim', async () => {
  // upstream echoes { method, url }; expect '/api/v1/chat/completions?x=1' unchanged
});

it('passes GET requests and non-JSON bodies through untouched', async () => {
  // upstream echoes the raw body; POST text/plain body comes back byte-identical
});

it('keeps max_tokens for models that accept it', async () => {
  // model 'gpt-4.1' -> upstream sees { max_tokens: 100 }, no max_completion_tokens
});

it('swaps max_tokens for max_completion_tokens when the model requires it', async () => {
  // model 'gpt-6.1-terra' -> upstream sees { max_completion_tokens: 100 }, no max_tokens
});

it('streams SSE responses without buffering or rewriting', async () => {
  // upstream writes two events split across TCP chunks then [DONE];
  // expect the client body to contain both events and end with 'data: [DONE]'
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: FAIL — `src/proxy/openai-param-proxy.ts` does not exist.

- [ ] **Step 3: Implement the proxy**

Create `src/proxy/openai-param-proxy.ts`:

- Resolve `upstream` with `new URL(options.upstreamUrl)`; choose `https` or `http` by protocol.
- In the request handler, build `targetUrl = new URL(req.url ?? '/', upstream.origin)` — keep the incoming path and query as-is; do **not** call `normalizeProxyUpstream`.
- Read the body only for `POST`/`PATCH`/`PUT` with `content-type: application/json`; parse it, and when `requiresMaxCompletionTokens(String(parsed.model))` swap with `withMaxCompletionTokens(parsed)`. On parse failure forward the raw bytes.
- Headers: copy incoming headers minus `host`, `content-length`, `transfer-encoding`; set `content-length` when the body was rewritten.
- Stream `proxyRes.pipe(res)` without touching the response body or content headers. Only the request direction is inspected.
- `proxyReq.setTimeout(timeoutMs ?? 120_000, () => proxyReq.destroy(new Error('upstream timeout')))`; on error return `502` JSON when headers are not sent.
- `listen(0, '127.0.0.1')` and expose `{ url, stop: () => stopServer(server) }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/proxy/openai-param-proxy.ts src/proxy/openai-param-proxy.test.ts
git commit -m "feat(proxy): add OpenAI parameter pass-through proxy"
```

---

### Task 2: Retry once when an unknown model rejects `max_tokens`

**Files:**
- Modify: `src/proxy/openai-param-proxy.ts`
- Test: `src/proxy/openai-param-proxy.test.ts`

**Interfaces:**
- Consumes: `isMaxTokensUnsupportedError`, `withMaxCompletionTokens` from `src/proxy/openai-adapter.ts`.
- Produces: no new exports; `startOpenAIParamProxy` behaviour gains a single retry.

- [ ] **Step 1: Write the failing tests**

```ts
it('retries once with max_completion_tokens when the upstream rejects max_tokens', async () => {
  // first call: 400 { error: { message: "Unsupported parameter: 'max_tokens'
  //   is not supported with this model. Use 'max_completion_tokens' instead." } }
  // second call: 200 JSON; expect two upstream bodies, second has
  // max_completion_tokens: 100 and no max_tokens; client sees 200
});

it('does not retry a second time when the retried request is also rejected', async () => {
  // upstream always returns the same 400; expect exactly two upstream calls
  // and the 400 body/status returned to the client
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: FAIL — the retry tests see one upstream call and a 400.

- [ ] **Step 3: Implement the retry**

Restructure the upstream send into a function (mirror `sendUpstream` in `src/proxy/openai-proxy.ts`). Buffer the response body only when `statusCode === 400`; if the request body exists, `isMaxTokensUnsupportedError(parsedBody)` is true and no retry has happened yet, rewrite the body with `withMaxCompletionTokens`, recompute `content-length`, resend, and return without writing to the client. Every other response is piped unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: PASS (all seven).

- [ ] **Step 5: Commit**

```bash
git add src/proxy/openai-param-proxy.ts src/proxy/openai-param-proxy.test.ts
git commit -m "feat(proxy): retry max_tokens rejection once with max_completion_tokens"
```

---

### Task 3: Routing decision helpers

**Files:**
- Modify: `src/proxy/openai-param-proxy.ts`
- Test: `src/proxy/openai-param-proxy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProxyCandidate { model: string; baseUrl: string }
  export function shouldProxyModel(model: string, baseUrl: string): boolean
  export function collectProxyUpstreams(candidates: ProxyCandidate[]): string[]
  ```
  `shouldProxyModel` is true when `requiresMaxCompletionTokens(model)` or when `new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com'`; an unparsable URL returns false. `collectProxyUpstreams` returns distinct `baseUrl` values in first-seen order, filtered by `shouldProxyModel`.

- [ ] **Step 1: Write the failing tests**

```ts
it('proxies models that require max_completion_tokens', () => {
  expect(shouldProxyModel('gpt-6.1-terra', 'https://example.com/v1')).toBe(true);
  expect(shouldProxyModel('o3-mini', 'https://example.com/v1')).toBe(true);
});

it('proxies any model served by api.openai.com, including unknown families', () => {
  expect(shouldProxyModel('gpt-7-future', 'https://api.openai.com/v1')).toBe(true);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: FAIL — the helpers are not exported.

- [ ] **Step 3: Implement the helpers**

Add the two functions and `ProxyCandidate` to `src/proxy/openai-param-proxy.ts`, importing `requiresMaxCompletionTokens`. Do not start a server in these helpers.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: PASS (all eleven).

- [ ] **Step 5: Commit**

```bash
git add src/proxy/openai-param-proxy.ts src/proxy/openai-param-proxy.test.ts
git commit -m "feat(proxy): decide which Qwen models need the parameter proxy"
```

---

### Task 4: Start the proxy from the launch transaction

**Files:**
- Modify: `src/launcher/transaction.ts` (import block; `maybeStartProxy` around lines 265-313)
- Test: `src/launcher/transaction.test.ts` (mock block around lines 30-62; new tests before the closing `});`)

**Interfaces:**
- Consumes: `startOpenAIParamProxy`, `collectProxyUpstreams` from Task 1/3; `adapter.writeConfig`, `resolveBaseModel` helpers already imported.
- Produces: private `startQwenParamProxies(adapter, scope, cwd, writtenConfig): Promise<(() => Promise<void>) | undefined>`, dispatched from `maybeStartProxy` when `adapter.id === 'qwen'`.

- [ ] **Step 1: Write the failing tests**

In `src/launcher/transaction.test.ts`:

- Mock the new module next to the existing proxy mocks:
  ```ts
  vi.mock('../proxy/openai-param-proxy.js', () => ({
    startOpenAIParamProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:7777', stop: vi.fn() }),
  }));
  ```
  and reset the `vi.mocked(startOpenAIParamProxy)` implementation in `beforeEach` like the other proxies.
- Add `makeQwenAdapter(config)` that returns an adapter with `id: 'qwen'`, `buildConfig` returning the supplied Qwen-shaped config and `writeConfig: vi.fn()`.
- Tests:
  1. `it('routes needing models through the parameter proxy and keeps envKey')` — config has one `openai` model `gpt-6.1-terra` with `baseUrl: 'https://api.openai.com/v1'` and `envKey: 'QWEN_CUSTOM_API_KEY_OPENAI_HTTPS_API_OPENAI_COM_V1'`; after `prepareLaunchTransaction` the second `writeConfig` call has `baseUrl === 'http://127.0.0.1:7777/v1'` and the original `envKey` and `generationConfig` unchanged.
  2. `it('preserves a custom upstream path when rewriting baseUrl')` — `baseUrl: 'https://openrouter.ai/api/v1'` with model `gpt-6` → rewritten to `'http://127.0.0.1:7777/api/v1'` (trailing-slash variant `https://openrouter.ai/api/v1/` gives the same result).
  3. `it('leaves models that do not need the proxy on their direct baseUrl')` — `qwen3.8-max` on `https://dashscope.example.com/v1` is untouched and `startOpenAIParamProxy` is not called.
  4. `it('starts one proxy per distinct upstream and stops all on cleanup')` — two qualifying upstreams; `startOpenAIParamProxy` called twice; every returned `stop` is invoked by `cleanup()`.
  5. `it('fails the launch when a parameter proxy cannot start')` — mock rejects with `new Error('proxy boom')`; `prepareLaunchTransaction` rejects with that error and does not resolve an exec request.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/launcher/transaction.test.ts`
Expected: FAIL — `startOpenAIParamProxy` is never called.

- [ ] **Step 3: Implement `startQwenParamProxies`**

In `src/launcher/transaction.ts`:

- `interface QwenModelEntry { id?: unknown; baseUrl?: unknown; [key: string]: unknown }`
- Read `writtenConfig.modelProviders`; for each array of entries collect `{ model: String(entry.id ?? ''), baseUrl: String(entry.baseUrl ?? '') }` and remember the entry object.
- `const upstreams = collectProxyUpstreams(candidates)`; return `undefined` when empty.
- For each upstream `await startOpenAIParamProxy({ upstreamUrl: upstream })`; store `Map<upstream, url>`.
- Deep-copy `modelProviders` (entries and their arrays; leave every other key by reference) and for each entry whose `baseUrl` is in the map set `baseUrl = proxyUrl + new URL(upstream).pathname.replace(/\/+$/, '')`.
- `await adapter.writeConfig({ ...writtenConfig, modelProviders: patched }, scope, cwd, false)`.
- Return `async () => { await Promise.all(stops.map((stop) => stop())); }`.
- At the top of `maybeStartProxy`, before the `claude-code` check:
  ```ts
  if (adapter.id === 'qwen') {
    return startQwenParamProxies(adapter, scope, cwd, writtenConfig);
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/launcher/transaction.test.ts`
Expected: PASS, including the five new tests.

- [ ] **Step 5: Commit**

```bash
git add src/launcher/transaction.ts src/launcher/transaction.test.ts
git commit -m "feat(qwen): route max_completion_tokens models through a local proxy"
```

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `AGENTS.md` (Qwen row and the proxy section)
- Modify: `README.md` (Qwen/OpenAI note)
- Modify: `CHANGELOG.md` (`[Unreleased] → Added`)

**Interfaces:**
- Consumes: behaviour produced by Tasks 1-4.
- Produces: no code.

- [ ] **Step 1: Update the docs**

- `AGENTS.md`, Qwen row: add that models needing `max_completion_tokens` (o-series, gpt-5+, gpt-6+, everything on `api.openai.com`) run through `src/proxy/openai-param-proxy.ts`; `baseUrl` in `modelProviders` points at a loopback proxy during the launch, `envKey` stays derived from the real URL.
- `AGENTS.md`, proxy section: add a **Qwen parameter proxy** subsection covering routing rule, retry, and cleanup.
- `CHANGELOG.md` under `[Unreleased] → Added`: one line about Qwen + OpenAI gpt-5+/gpt-6 models.
- `README.md`: one sentence in the Qwen description.

- [ ] **Step 2: Run the full verification**

```bash
npm run typecheck
npm run lint
npm test
npm run build
node dist/bin/agento.js --version
```
Expected: typecheck and lint clean; all tests pass (previous count 1075 passed / 4 skipped, plus the new tests); build prints `0.11.0`.

- [ ] **Step 3: Smoke-test against the real API (manual, uses the user's key)**

Start `startOpenAIParamProxy` from `dist/` against `https://api.openai.com/v1`, send an OpenAI-shaped request for `gpt-6.1-terra` with `max_tokens: 32`, and confirm `200`. This mirrors the earlier Claude Code verification; do not print the key.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md CHANGELOG.md
git commit -m "docs: describe the Qwen parameter proxy"
```

---

## Execution notes

- `src/launcher/transaction.test.ts` mocks `./shell-path-resolver.js` and `../config/store.js`; keep those mocks intact and add only the new proxy mock.
- The Qwen adapter writes `modelProviders.openai[]`; do not assume other provider keys exist, iterate every key.
- `adapter.writeConfig` is called twice for a proxied Qwen launch (real config, then patched config). Cleanup restores from the backup written before the first call, so both writes are reverted.
