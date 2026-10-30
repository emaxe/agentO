# Qwen: local pass-through proxy for `max_completion_tokens`

## Intent

Qwen CLI builds OpenAI Chat Completions requests itself and hardcodes `max_tokens`
(`applyOutputTokenLimit` in qwen-code 0.26.4). Models that only accept
`max_completion_tokens` — o-series, gpt-5 and newer, currently the `gpt-6-*` models
in the OpenAI provider — reject every request with HTTP 400. AgentO cannot change
the agent code, but it already knows how to start a local proxy and rewrite the
generated config before the agent starts (Claude Code does exactly that for
protocol translation). This change gives Qwen the same treatment, without protocol
translation: a transparent OpenAI-to-OpenAI proxy that only swaps the output-token
parameter.

## Why the proxy and not the config

Qwen supports `generationConfig.samplingParams` per model, but setting it disables
Qwen's own output-ceiling calculation, so AgentO would have to invent a token limit
for every model. That changes behaviour beyond the parameter name. The proxy keeps
Qwen's own defaults: the request body is forwarded unchanged except for the
parameter name.

## Goals

- A launch of Qwen with a model that needs `max_completion_tokens` succeeds against
  the real OpenAI API.
- Models and providers that already work keep talking to the upstream directly.
- One retry when a model that AgentO did not recognise rejects `max_tokens`, so an
  unknown future model still works when it happens to be proxied.
- Behaviour is identical on macOS, Linux and Windows; cleanup restores the config
  and stops every proxy the launch started.

## Non-goals

- No proxy for other agents (OpenCode, Codex, PI, Kimi, Kilo). The transaction hook
  stays available for them later.
- No request/response translation, token counting, logging of prompts or keys.
- No rewriting of other parameters (`temperature`, `reasoning_effort`, …).

## Anti-goals

- A silent fallback that sends `max_tokens` to a model known to reject it.
- Proxying traffic that does not need it: Qwen-native models, DeepSeek, Ollama and
  third-party OpenAI-compatible gateways keep their direct `baseUrl`.

## Chosen approach

**A. Proxy only the models that need it.** For every model entry AgentO writes into
`modelProviders.openai[]`, route it through the proxy when either

1. `requiresMaxCompletionTokens(model)` matches (o-series, gpt-5+, gpt-6+, prefix
   such as `openai/…` ignored), or
2. the resolved `baseUrl` host is `api.openai.com` — this covers new OpenAI families
   that the name heuristic does not know yet.

Everything else is left untouched.

Rejected alternatives:

- **B. Route all Qwen traffic through one proxy.** Simpler wiring and the retry net
  covers everything, but inserts a local hop for Qwen, DeepSeek, Ollama and gateway
  providers that never had the problem.
- **C. Write `samplingParams` into the Qwen config.** No proxy, but it overrides
  Qwen's output ceiling and needs a made-up token number per model.

## Design

### New module: `src/proxy/openai-param-proxy.ts`

`startOpenAIParamProxy({ upstreamUrl, timeoutMs? }): Promise<ProxyServer>` — reuses
the `ProxyServer` shape from the existing proxies.

- Forwards method, path and query **verbatim** to the upstream origin. The caller
  installs `proxy.url + <original pathname>` as the model `baseUrl`, so the OpenAI
  SDK's `/chat/completions` suffix lands on the same path the upstream expects.
  No `/v1` normalisation.
- POST JSON bodies are parsed only to swap the parameter:
  `requiresMaxCompletionTokens(model)` → `max_tokens` becomes
  `max_completion_tokens` (via `withMaxCompletionTokens`). Bodies that already use
  `max_completion_tokens`, non-JSON bodies and non-POST requests pass through
  byte-for-byte.
- On a 400 whose JSON error text names both `max_tokens` and
  `max_completion_tokens` (`isMaxTokensUnsupportedError`), resend once with the
  swapped body. A second 400 is returned to the agent unchanged.
- Responses are piped untouched (SSE, compressed bodies, error bodies), so there is
  no response transformation and no `accept-encoding` override.
- Outbound connections use `getOutboundAgent(upstream)` so an external system proxy
  still works; `stop()` uses `stopServer`.

Helpers reused from `src/proxy/openai-adapter.ts`:
`requiresMaxCompletionTokens`, `isMaxTokensUnsupportedError`,
`withMaxCompletionTokens`.

### Routing: `maybeStartProxy` in `src/launcher/transaction.ts`

After the config is written, before the agent is spawned:

- For `adapter.id === 'qwen'`, read `modelProviders` from the written config.
- Group qualifying entries by resolved `baseUrl`; start one proxy per distinct
  upstream (usually one).
- Rewrite each qualifying entry's `baseUrl` to `proxy.url + originalPathname`
  (trailing slash trimmed). `id`, `name`, `envKey` and `generationConfig` stay as
  they are — `envKey` is the name of the environment variable holding the real API
  key, and the proxy forwards the `Authorization` header Qwen already sends.
- Write the patched config back with `adapter.writeConfig(..., false)` (no merge),
  matching the Claude Code path.
- Return one cleanup that stops every proxy, composed with the existing launch
  cleanup.

If a proxy cannot start, the launch fails before the agent spawns — no silent
fallback.

The adapter interface does not change: routing is decided from the written config,
which already contains per-model `id` and `baseUrl`.

## Testing

- Proxy unit tests (`src/proxy/openai-param-proxy.test.ts`, local fake upstream):
  path/query passthrough with a custom prefix such as `/api/v1`; GET and non-JSON
  passthrough; qualifying model gets `max_completion_tokens` and no `max_tokens`;
  non-qualifying model keeps `max_tokens`; 400 retry once then success; second 400
  is not retried; streaming body is forwarded verbatim.
- Routing helper tests: `api.openai.com` host qualifies regardless of name;
  Qwen/DeepSeek/Ollama hosts do not; gpt-6 qualifies; gpt-4.1 does not; entries are
  grouped by baseUrl.
- Transaction test with a fake adapter-less config: after `prepareLaunchTransaction`
  the config points qualifying entries at `127.0.0.1`, leaves others alone, and
  `cleanup()` restores the original config and stops the proxies.

## Documentation

- `AGENTS.md`: Qwen row and the proxy section — Qwen uses a pass-through proxy for
  models that reject `max_tokens`.
- `CHANGELOG.md`: `[Unreleased] → Added`.
- `README.md`: one user-visible line about OpenAI gpt-5+/gpt-6 models in Qwen.

## Left to the builder

- Exact naming of the routing helper and whether it lives in the proxy module or the
  Qwen adapter (leaning proxy module, pure and testable).
- Whether `timeoutMs` is reused as-is from the other proxies (yes, 120 s default).
- Test file layout for the transaction-level case, following the existing
  `transaction.codex.test.ts` pattern.
