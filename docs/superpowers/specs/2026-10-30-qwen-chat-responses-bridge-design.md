# Qwen: Chat Completions → Responses bridge in the parameter proxy

## Intent

Some OpenAI gpt-6+ families (`gpt-6.1-sol`, `gpt-6-astra`) are reasoning-only:
`/v1/chat/completions` refuses function tools for them no matter what
`reasoning_effort` is set to. Qwen CLI only speaks Chat Completions, so a launch
with such a model dies mid-session with a 400 that has no workaround on the client
side. The same hosts serve the tools fine through `/v1/responses`. AgentO already
runs a local proxy in front of Qwen; this change teaches that proxy to replay the
request through the Responses API and translate the answer back.

## Evidence (probed live against `api.openai.com`, `gpt-6*`, one function tool)

| model | `reasoning_effort: "none"` | no `reasoning_effort` |
|---|---|---|
| `gpt-6-luna` | 200 | 400 "Function tools with reasoning_effort are not supported" |
| `gpt-6.1-terra` | 200 | 400 same |
| `gpt-6-astra` | 400 "does not support 'none'. Supported: low, medium, high, xhigh" | 400 same tools error |
| `gpt-6.1-sol` | 400 same "none" error | 400 same tools error |

`/v1/responses` with `tools` + `reasoning.effort: "low"` (or no `reasoning` at all)
returns 200 for `gpt-6.1-sol`, including streamed `function_call` output.

Parameters probed on `/v1/responses` for `gpt-6.1-sol`: accepted — `instructions`,
`tool_choice` (`"required"` and `{type:"function",name}`), `parallel_tool_calls`,
`max_output_tokens`, `store:false`; rejected — `temperature`, `top_p`,
`presence_penalty`, `stop`, `seed`.

`gpt-6-astra` on `/v1/responses` with tools returns 200 both with no `reasoning`
object and with `reasoning:{effort:"low"}`, so the bridge omits `reasoning`
entirely and leaves the model at its own default. `api.openai.com` does not
compress 400 error bodies (`content-encoding` absent), but the proxy still forces
`accept-encoding: identity` upstream — a compressed error body would silently
defeat both 400 detectors.

## Goals

- A Qwen launch with `gpt-6.1-sol` / `gpt-6-astra` gets working function tools and
  a coherent answer, streaming included.
- Models that already work (`gpt-6-luna`, `gpt-6.1-terra`, everything else) keep the
  current code path byte-for-byte: no extra request, no shape change.
- One bridge attempt per request. No loops, no hidden retries.
- When the upstream has no `/v1/responses`, the client sees an error that says what
  actually happened instead of hanging or receiving a half-translated body.

## Non-goals

- No bridge for Claude Code's `openai-compatible` path in this change (its
  `openai-proxy.ts` can adopt the same adapter later; Claude Code users can already
  select a `responses-compatible` provider).
- No reasoning summaries / thinking blocks in the bridge output: Qwen renders text
  and tool calls only.
- No prompt, key or body logging (unchanged policy of every AgentO proxy).
- No support for Chat Completions features the Responses API lacks (`logprobs`, `n`,
  `stop`, sampling knobs) — they are dropped, which is exactly what the upstream
  requires for these models.

## Anti-goals

- Bridging pre-emptively for every gpt-6+ request. Only a 400 that proves Chat
  Completions cannot serve the request may trigger it.
- Silently stripping `tools` and running a coding agent without tool access.
- Emitting a `chat.completion` body for a `stream: true` request (or vice versa).

## Chosen approach

**A. Retry-driven bridge inside `openai-param-proxy.ts`, with pure adapters in a new
module.**

Trigger — the request carried `tools` and the upstream 400 is either
`isToolsReasoningUnsupportedError` (tools + reasoning) or a new
`isReasoningEffortValueUnsupportedError` for the value `none`. In practice the sol
flow is: attempt 1 sends `reasoning_effort: "none"` (existing gpt-6+ rewrite) → 400
"does not support 'none'" → bridge.

The bridge:

1. Builds a Responses request from the parsed Chat Completions body with
   `convertChatRequestToResponses`, using the client's original `reasoning_effort`
   (snapshotted before the proxy's own rewrites), so an effort the client asked for
   is not silently replaced by the injected `none`.
2. POSTs it to the Responses endpoint derived from the original path: trailing
   `/chat/completions` → `/responses`; otherwise `dirname(originalPath) + '/responses'`.
   Query string is preserved. Client headers are reused (`Authorization` and the
   rest pass through; framing headers are already stripped by `copyForwardHeaders`),
   with `content-length` recomputed and `accept-encoding: identity` forced.
3. Non-stream: buffers the JSON answer and returns `convertResponsesToChatResponse`.
   Stream: parses upstream SSE and emits `chat.completion.chunk` frames via
   `createChatStreamState` + `convertResponsesEventToChatChunks`, then `data: [DONE]`.
4. Framing follows the **request's** `stream` flag, not the upstream content type.
   A gateway that ignores `stream` is still handled: a JSON body for a streaming
   request is split into role/content/tool-call/finish chunks, and an SSE body for a
   non-streaming request is collected through the same stream state into one
   `chat.completion` object.
5. Failure: a non-2xx bridge response with a JSON error body is returned verbatim
   (it is already OpenAI-shaped and names the real cause). A non-JSON bridge failure
   returns the original Chat Completions 400 body, so the user still sees the
   "use /v1/responses" message rather than a bare 404 page. A 2xx answer whose
   `status` is `failed` (or that carries a top-level `error`) is surfaced as
   `{error:{message, type}}` with status 502, or as a streamed `error` frame followed
   by `[DONE]`, instead of an empty successful completion.

Rejected alternatives:

- **B. Fail fast with a friendly launch-time error** ("this model cannot use tools
  over Chat Completions; pick terra/luna"). Honest and cheap, but leaves sol/astra
  unusable in Qwen, which is the reported problem.
- **C. Strip `tools` when the model refuses them.** Turns a coding agent into a chat
  bot without saying so. Fails the anti-goal.
- **D. Translate in the Qwen config instead** (point `baseUrl` at `/v1/responses`).
  Qwen emits Chat Completions bodies; the endpoint would reject them.

## Request mapping (`convertChatRequestToResponses`)

| Chat Completions | Responses |
|---|---|
| `model` | `model` |
| `messages[]` with role `system`/`developer` | joined into `instructions` |
| `messages[].role: "user"`, string content | `{type:"message", role:"user", content:[{type:"input_text",text}]}` |
| user content part `{type:"text"}` | `{type:"input_text"}` |
| user content part `{type:"image_url"}` | `{type:"input_image", image_url: <url>}` |
| `messages[].role: "assistant"`, text | `{type:"message", role:"assistant", content:[{type:"output_text"}]}` |
| `assistant.tool_calls[]` | `{type:"function_call", call_id, name, arguments}` |
| `messages[].role: "tool"` | `{type:"function_call_output", call_id, output}` |
| `tools[{type:"function", function:{name,description,parameters}}]` | `tools[{type:"function", name, description, parameters}]` |
| `tool_choice` `auto`/`required`/`none`/`{type:"function",function:{name}}` | `auto`/`required`/`none`/`{type:"function",name}` |
| `max_completion_tokens` ?? `max_tokens` | `max_output_tokens` |
| original `reasoning_effort` in {low, medium, high, xhigh, max} | `reasoning: {effort}` |
| original `reasoning_effort` `none`, `minimal` or absent | omitted (model default) |
| `stream` | `stream` |
| — (always) | `store: false` |
| `temperature`, `top_p`, `stop`, `seed`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `n`, `stream_options`, unknown fields | dropped |

## Response mapping

Non-stream `convertResponsesToChatResponse`: `output_text` parts joined into
`choices[0].message.content` (null when the answer is tool calls only);
`function_call` items become `tool_calls[{id, type:"function", function:{name, arguments}}]`;
`finish_reason` is `tool_calls` when any call is present, `length` when
`incomplete_details.reason` is `max_output_tokens`, `content_filter` for
`content_filter`, else `stop`; usage maps
`input_tokens`/`output_tokens`/`total_tokens` to
`prompt_tokens`/`completion_tokens`/`total_tokens`.

`tool_calls[].id` is the Responses `call_id` (`call_…`), not the item `id` (`fc_…`):
Qwen echoes it back as `tool_call_id`, which the reverse mapping turns into
`function_call_output.call_id`. Falls back to `id` when `call_id` is missing.

Stream `convertResponsesEventToChatChunks` (state: id, model, `created` timestamp,
sequential tool-call index, emitted-role flag, usage):

| Responses event | Chat Completions chunk |
|---|---|
| `response.created` | first chunk with `delta:{role:"assistant"}` |
| `response.output_text.delta` | `delta:{content}` |
| `response.output_item.added` (`function_call`) | `delta:{tool_calls:[{index, id, type:"function", function:{name, arguments:""}}]}` |
| `response.function_call_arguments.delta` | `delta:{tool_calls:[{index, function:{arguments}}]}` |
| `response.completed` / `response.incomplete` | final chunk with `finish_reason` + `usage`, then `data: [DONE]` |
| `response.failed` / `error` | `data: {"error": {...}}` then `data: [DONE]` |

## Touch list

- `src/proxy/chat-responses-adapter.ts` — new, pure conversions + stream state.
- `src/proxy/openai-adapter.ts` — add `isReasoningEffortValueUnsupportedError`.
- `src/proxy/openai-param-proxy.ts` — force `accept-encoding: identity` upstream,
  bridge trigger, responses endpoint derivation, bridge request/response plumbing,
  one-shot guard.
- `src/proxy/chat-responses-adapter.test.ts` — new unit tests.
- `src/proxy/openai-param-proxy.test.ts` — bridge integration tests with a fake
  upstream: streamed bridge (`[DONE]`, tool-call chunks), non-stream bridge, original
  `reasoning_effort` preserved, `call_id` used as `tool_call_id` round-trip, request
  without tools never bridged, exactly one bridge attempt, `status: "failed"`
  surfaced, non-JSON bridge failure falls back to the original 400.
- `AGENTS.md`, `README.md`, `README.ru.md`, `CHANGELOG.md` — behaviour notes.

## Verification

`npm run typecheck && npm test && npm run lint`, then a real launch:
`agento launch -p <profile with gpt-6.1-sol> -a qwen` and one tool-using turn.
A manual probe of the bridge against `api.openai.com` confirms the request shape;
no key is printed.
