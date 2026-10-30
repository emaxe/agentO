# Qwen Chat Completions → Responses Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When OpenAI gpt-6+ reasoning-only models (`gpt-6.1-sol`, `gpt-6-astra`) reject function tools on `/v1/chat/completions`, replay the request through `/v1/responses` so Qwen CLI keeps working with tools.

**Architecture:** Pure conversion functions in a new `src/proxy/chat-responses-adapter.ts` (request, non-stream response, streamed chunks) plus one extra 400 detector. `src/proxy/openai-param-proxy.ts` triggers the bridge once per request, derives the `/responses` endpoint, and reuses its existing upstream plumbing (headers, timeout, abort) to relay the translated answer.

**Tech Stack:** TypeScript (ESM), Node `http`/`https`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-qwen-chat-responses-bridge-design.md`

## Global Constraints

- No request, key or body logging in any proxy path.
- The proxied request must be byte-for-byte unchanged for models that work today (`gpt-6-luna`, `gpt-6.1-terra`, gpt-5, non-OpenAI hosts).
- At most one bridge attempt per client request.
- `tools` are never stripped or dropped.
- New tests must not use POSIX path literals; this change adds no path handling, so all fixtures are HTTP URLs and JSON.
- TypeScript strict mode; `npm run typecheck`, `npm test`, `npm run lint` must pass at the end.

## Review Focus

- Multi-turn tool loop: the assistant turn's `tool_calls[].id` comes back as `messages[].tool_call_id`; a wrong id (`fc_…` instead of `call_…`) breaks the second turn with a 400.
- User messages that mix text and images: conversion must keep both `input_text` and `input_image` parts, in order.
- Upstream error bodies that are compressed or non-JSON: the proxy must not crash and must fall back to the original Chat Completions 400.
- An empty answer (only reasoning, no text, no tool calls): `message.content` must be `null`, never the string `"null"` or `undefined`.
- Bridge upstream hangs or client aborts mid-stream: the client must get an error/close, not a hung response.

---

### Task 1: Detector + request conversion

**Files:**
- Modify: `src/proxy/openai-adapter.ts` (add detector next to `isToolsReasoningUnsupportedError`, ~line 130)
- Create: `src/proxy/chat-responses-adapter.ts`
- Test: `src/proxy/openai-adapter.test.ts` (append detector tests), `src/proxy/chat-responses-adapter.test.ts` (create)

**Interfaces:**
- Consumes: `OpenAIRequest` from `./openai-adapter.js`.
- Produces:
  - `isReasoningEffortValueUnsupportedError(payload: unknown): boolean`
  - `convertChatRequestToResponses(req: OpenAIRequest, options?: { originalReasoningEffort?: string }): Record<string, unknown>`

- [ ] **Step 1: Write the failing detector test**

Append to `src/proxy/openai-adapter.test.ts`:

```ts
describe('isReasoningEffortValueUnsupportedError', () => {
  it('matches the reasoning-only model rejection of none', () => {
    expect(
      isReasoningEffortValueUnsupportedError({
        error: {
          message:
            "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'.",
        },
      }),
    ).toBe(true);
  });

  it('ignores unrelated 400s', () => {
    expect(isReasoningEffortValueUnsupportedError({ error: { message: 'bad request' } })).toBe(
      false,
    );
    expect(
      isReasoningEffortValueUnsupportedError({
        error: { message: "Unsupported parameter: 'temperature' is not supported" },
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/proxy/openai-adapter.test.ts -t isReasoningEffortValueUnsupportedError`
Expected: FAIL — `isReasoningEffortValueUnsupportedError is not a function` / import error.

- [ ] **Step 3: Implement the detector**

In `src/proxy/openai-adapter.ts`, next to `isToolsReasoningUnsupportedError`, add a doc-commented function that reads `payload.error.message` and returns true only when the lower-cased message contains both `reasoning_effort` and `does not support` (the sol/astra 400 wording). Return false for non-object payloads, missing `error`, or non-string `message`, matching the existing detectors.

- [ ] **Step 4: Run the detector test**

Run: `npx vitest run src/proxy/openai-adapter.test.ts -t isReasoningEffortValueUnsupportedError`
Expected: PASS.

- [ ] **Step 5: Write the failing request-conversion tests**

Create `src/proxy/chat-responses-adapter.test.ts` with these cases (exact assertions):

```ts
import { describe, it, expect } from 'vitest';
import { convertChatRequestToResponses } from './chat-responses-adapter.js';

const TOOL = {
  type: 'function',
  function: { name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } },
};

describe('convertChatRequestToResponses', () => {
  it('maps system text to instructions and user text to input_text', () => {
    const out = convertChatRequestToResponses({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'developer', content: 'and polite' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(out.instructions).toBe('be terse\n\nand polite');
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ]);
    expect(out.store).toBe(false);
  });

  it('maps tools, tool_choice and max tokens', () => {
    const out = convertChatRequestToResponses({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'ping' } },
      max_completion_tokens: 256,
    });
    expect(out.tools).toEqual([
      { type: 'function', name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } },
    ]);
    expect(out.tool_choice).toEqual({ type: 'function', name: 'ping' });
    expect(out.max_output_tokens).toBe(256);
    expect(out.max_tokens).toBeUndefined();
  });

  it('maps an assistant tool call and its result round-trip', () => {
    const out = convertChatRequestToResponses({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'user', content: 'run ping' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'ping', arguments: '{"x":1}' } }],
        },
        { role: 'tool', tool_call_id: 'call_a', content: 'pong' },
      ],
    });
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'run ping' }] },
      { type: 'function_call', call_id: 'call_a', name: 'ping', arguments: '{"x":1}' },
      { type: 'function_call_output', call_id: 'call_a', output: 'pong' },
    ]);
  });

  it('keeps mixed text and image user content in order', () => {
    const out = convertChatRequestToResponses({
      model: 'gpt-6.1-sol',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
          ],
        },
      ],
    });
    expect(out.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'what is this' },
          { type: 'input_image', image_url: 'https://example.test/a.png' },
        ],
      },
    ]);
  });

  it('drops sampling parameters the responses API rejects', () => {
    const out = convertChatRequestToResponses({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      top_p: 0.9,
      stop: 'END',
      seed: 5,
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      logit_bias: { '1': 1 },
      max_tokens: 42,
      stream: true,
    });
    for (const key of ['temperature', 'top_p', 'stop', 'seed', 'presence_penalty', 'frequency_penalty', 'logit_bias']) {
      expect(out[key]).toBeUndefined();
    }
    expect(out.max_output_tokens).toBe(42);
    expect(out.stream).toBe(true);
  });

  it('sends the client effort when supported and omits none', () => {
    const high = convertChatRequestToResponses(
      { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }] },
      { originalReasoningEffort: 'high' },
    );
    expect(high.reasoning).toEqual({ effort: 'high' });
    const none = convertChatRequestToResponses(
      { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }] },
      { originalReasoningEffort: 'none' },
    );
    expect(none.reasoning).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the conversion tests and watch them fail**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts`
Expected: FAIL — module `./chat-responses-adapter.js` not found.

- [ ] **Step 7: Implement `convertChatRequestToResponses`**

Create `src/proxy/chat-responses-adapter.ts` with the exported signature from Interfaces. Rules:
- Collect `system`/`developer` message text (string content, or `text` parts) into `instructions`, joined by `\n\n`; omit when empty.
- Walk `messages` in order: user/assistant plain text → `{type:'message', role, content:[{type:'input_text'|'output_text', text}]}`; assistant `tool_calls[]` → `{type:'function_call', call_id, name, arguments}` (arguments as the given JSON string, default `'{}'`); `role:'tool'` → `{type:'function_call_output', call_id, output}` (stringify non-string content, `''` when absent).
- User content parts: `{type:'text'}` → `input_text`; `{type:'image_url', image_url:{url}}` → `{type:'input_image', image_url: url}`; ignore other part types.
- Only these top-level fields go upstream: `model`, `input`, `instructions` (when present), `tools` (converted `function` shape), `tool_choice` (normalized: `{type:'function',function:{name}}` → `{type:'function',name}`; strings pass through), `max_output_tokens` from `max_completion_tokens ?? max_tokens`, `reasoning` (only when `options.originalReasoningEffort` is one of `low`, `medium`, `high`, `xhigh`, `max`), `stream` (default `false`), and `store: false`.
- Everything else on the input request is ignored (that is the "dropped parameters" rule).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts src/proxy/openai-adapter.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/proxy/chat-responses-adapter.ts src/proxy/chat-responses-adapter.test.ts src/proxy/openai-adapter.ts src/proxy/openai-adapter.test.ts
git commit -m "feat(proxy): map chat completions requests to the responses API"
```

---

### Task 2: Non-stream response conversion

**Files:**
- Modify: `src/proxy/chat-responses-adapter.ts`
- Test: `src/proxy/chat-responses-adapter.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `convertResponsesToChatResponse(res: unknown, fallbackModel: string): Record<string, unknown>`
  - `responsesSseToChatResponse(events: Array<Record<string, unknown>>, fallbackModel: string): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

Append to `src/proxy/chat-responses-adapter.test.ts`:

```ts
describe('convertResponsesToChatResponse', () => {
  it('maps text output and usage', () => {
    const out = convertResponsesToChatResponse(
      {
        id: 'resp_1',
        object: 'response',
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello' }],
          },
        ],
        usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
      },
      'gpt-6.1-sol',
    );
    expect(out.object).toBe('chat.completion');
    expect(out.model).toBe('gpt-6.1-sol');
    expect((out.choices as any)[0].message).toEqual({ role: 'assistant', content: 'hello' });
    expect((out.choices as any)[0].finish_reason).toBe('stop');
    expect(out.usage).toEqual({ prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
  });

  it('maps function calls to tool_calls with call_id as id and null content', () => {
    const out = convertResponsesToChatResponse(
      {
        id: 'resp_2',
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'ping',
            arguments: '{"x":1}',
          },
        ],
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      },
      'gpt-6.1-sol',
    );
    const choice = (out.choices as any)[0];
    expect(choice.message.content).toBeNull();
    expect(choice.message.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{"x":1}' } },
    ]);
    expect(choice.finish_reason).toBe('tool_calls');
  });

  it('maps an incomplete max_output_tokens answer to length', () => {
    const out = convertResponsesToChatResponse(
      { id: 'resp_3', model: 'gpt-6.1-sol', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
      'gpt-6.1-sol',
    );
    expect((out.choices as any)[0].finish_reason).toBe('length');
  });

  it('collects an SSE stream into one completion', () => {
    const out = responsesSseToChatResponse(
      [
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'ping' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"x":1}' },
        { type: 'response.completed', response: { id: 'resp_4', model: 'gpt-6.1-sol', usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } },
      ],
      'gpt-6.1-sol',
    );
    const choice = (out.choices as any)[0];
    expect(choice.message.tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'ping', arguments: '{"x":1}' },
    });
    expect(choice.finish_reason).toBe('tool_calls');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts -t convertResponsesToChatResponse`
Expected: FAIL — `convertResponsesToChatResponse is not a function`.

- [ ] **Step 3: Implement both converters**

`convertResponsesToChatResponse` builds `{id, object:'chat.completion', created, model, choices:[{index:0, message, finish_reason}], usage}`. The message is `{role:'assistant', content}` where `content` is the joined `output_text` parts or `null` when empty, plus `tool_calls` when any `function_call` item exists (`id: call_id ?? id`, arguments default `'{}'`). `finish_reason`: `tool_calls` when calls exist, `length` for `incomplete_details.reason === 'max_output_tokens'`, `content_filter` for `content_filter`, else `stop`. Usage reads `input_tokens`/`output_tokens`/`total_tokens`, defaulting each to `0`, and total to the sum when absent.

`responsesSseToChatResponse` accumulates text deltas and function-call deltas per `output_index`, reads `usage` and `model` from the last `response.completed` event, and emits the synthetic Responses object (`status:'completed'`, `output` with a message item and `function_call` items) through `convertResponsesToChatResponse`. Missing deltas mean `''`; a missing `response.completed` still yields a `completed` object.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/chat-responses-adapter.ts src/proxy/chat-responses-adapter.test.ts
git commit -m "feat(proxy): convert responses API answers back to chat completions"
```

---

### Task 3: Streaming conversion

**Files:**
- Modify: `src/proxy/chat-responses-adapter.ts`
- Test: `src/proxy/chat-responses-adapter.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface ChatStreamState { id: string; created: number; model: string; roleSent: boolean; toolCallIndexByOutputIndex: Map<number, number>; nextToolCallIndex: number; finishReason: string | null }`
  - `createChatStreamState(id: string, model: string, created: number): ChatStreamState`
  - `convertResponsesEventToChatChunks(event: Record<string, unknown>, state: ChatStreamState): Array<Record<string, unknown>>`
  - `chatCompletionToStreamChunks(completion: Record<string, unknown>): Array<Record<string, unknown>>`

- [ ] **Step 1: Write the failing tests**

Append to `src/proxy/chat-responses-adapter.test.ts`:

```ts
describe('convertResponsesEventToChatChunks', () => {
  const collect = (events: Array<Record<string, unknown>>) => {
    const state = createChatStreamState('resp_1', 'gpt-6.1-sol', 1700000000);
    return events.flatMap((event) => convertResponsesEventToChatChunks(event, state));
  };

  it('emits role, text and finish chunks with usage', () => {
    const chunks = collect([
      { type: 'response.created' },
      { type: 'response.output_text.delta', output_index: 0, delta: 'he' },
      { type: 'response.output_text.delta', output_index: 0, delta: 'llo' },
      {
        type: 'response.completed',
        response: { model: 'gpt-6.1-sol', usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 } },
      },
    ]);
    expect(chunks[0]).toMatchObject({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] });
    expect(chunks[1]).toMatchObject({ choices: [{ delta: { content: 'he' } }] });
    expect(chunks[2]).toMatchObject({ choices: [{ delta: { content: 'llo' } }] });
    expect(chunks.at(-1)).toMatchObject({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
    });
  });

  it('emits tool call start and argument deltas', () => {
    const chunks = collect([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'ping' },
      },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"x":1}' },
      {
        type: 'response.completed',
        response: { model: 'gpt-6.1-sol', usage: {}, output: [{ type: 'function_call' }] },
      },
    ]);
    expect(chunks[1]).toMatchObject({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ping', arguments: '' } }],
          },
        },
      ],
    });
    expect(chunks[2]).toMatchObject({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] } }],
    });
    expect(chunks.at(-1)).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }] });
  });

  it('surfaces a failed response as an error frame', () => {
    const chunks = collect([
      { type: 'response.failed', response: { error: { message: 'boom' } } },
    ]);
    expect(chunks).toEqual([{ error: { message: 'boom', type: 'api_error' } }]);
  });
});

describe('chatCompletionToStreamChunks', () => {
  it('splits a completion into role, content, tool call and finish chunks', () => {
    const chunks = chatCompletionToStreamChunks({
      id: 'chatcmpl-1',
      created: 1700000000,
      model: 'gpt-6.1-sol',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect(chunks[0]).toMatchObject({ choices: [{ delta: { role: 'assistant' } }] });
    expect(chunks[1]).toMatchObject({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } }],
          },
        },
      ],
    });
    expect(chunks.at(-1)).toMatchObject({
      choices: [{ finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts -t convertResponsesEventToChatChunks`
Expected: FAIL — export missing.

- [ ] **Step 3: Implement the stream converter**

Chunk base: `{id: state.id, object:'chat.completion.chunk', created: state.created, model: state.model}` with `choices:[{index:0, delta, finish_reason: null}]`. Emit the `{delta:{role:'assistant'}}` chunk once, before translating any other event (including `response.created`). Handle exactly these events:
- `response.output_text.delta` → `{delta:{content: String(event.delta ?? '')}}`
- `response.output_item.added` with `item.type === 'function_call'` → register `state.toolCallIndexByOutputIndex` (keyed by `output_index`, default 0) with `state.nextToolCallIndex++` and emit the tool-call start chunk using `call_id ?? id`.
- `response.function_call_arguments.delta` → `{delta:{tool_calls:[{index, function:{arguments: String(event.delta ?? '')}}]}}`; if the index was never registered, register it now (start chunk with empty id/name, then the delta).
- `response.completed` / `response.incomplete` → finish chunk with `delta:{}` and `finish_reason` (`tool_calls` when the event's `response.output` contains a `function_call`, `length` for `incomplete_details.reason === 'max_output_tokens'`, else `stop`) plus `usage` from `response.usage` (`input_tokens`/`output_tokens`/`total_tokens` → `prompt_tokens`/`completion_tokens`/`total_tokens`); set `state.finishReason`.
- `response.failed`, `response.error`, and a top-level `error` → single `{error:{message, type:'api_error'}}` object, taking `response.error.message` or `event.error.message`.
- every other event → `[]` (reasoning summaries, `in_progress`, item-done, argument-done).

`chatCompletionToStreamChunks` maps a full completion: role chunk, one content chunk (when `content` is a non-empty string), one chunk per `tool_calls` entry (index in order), then a finish chunk carrying `finish_reason` and `usage`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/proxy/chat-responses-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/chat-responses-adapter.ts src/proxy/chat-responses-adapter.test.ts
git commit -m "feat(proxy): stream responses API events as chat completions chunks"
```

---

### Task 4: Bridge wiring in the parameter proxy

**Files:**
- Modify: `src/proxy/openai-param-proxy.ts`
- Test: `src/proxy/openai-param-proxy.test.ts`

**Interfaces:**
- Consumes: `convertChatRequestToResponses`, `convertResponsesToChatResponse`, `responsesSseToChatResponse`, `createChatStreamState`, `convertResponsesEventToChatChunks`, `chatCompletionToStreamChunks` from `./chat-responses-adapter.js`; `isReasoningEffortValueUnsupportedError` from `./openai-adapter.js`.
- Produces: `responsesEndpointPath(requestPath: string): string` (exported).

- [ ] **Step 1: Write the failing endpoint test**

Append to `src/proxy/openai-param-proxy.test.ts` (inside a new `describe`):

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts -t responsesEndpointPath`
Expected: FAIL — `responsesEndpointPath` is not exported.

- [ ] **Step 3: Implement the endpoint helper and force identity encoding**

Add `responsesEndpointPath` to `src/proxy/openai-param-proxy.ts`: trim one trailing slash, replace a trailing `/chat/completions` with `/responses`, otherwise join `dirname(path)` with `/responses` (root → `/responses`).

In `copyForwardHeaders`, set `headers['accept-encoding'] = 'identity'` after the copy loop so buffered 400 bodies are always readable, and update that function's doc comment to say why.

- [ ] **Step 4: Write the failing bridge integration tests**

Append to `src/proxy/openai-param-proxy.test.ts` a `describe('chat completions to responses bridge')` with a fake upstream that routes on `req.url`:

```ts
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
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-6.1-sol","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5},"output":[{"type":"message","content":[{"type":"output_text","text":"hi"}]}]}}',
  '',
].join('\n');
```

1. `it('bridges to the responses endpoint when none is rejected')` — upstream answers the first `/v1/chat/completions` POST with 400 `NONE_ERROR`, then answers `/v1/responses` with JSON `{id:'resp_1', model:'gpt-6.1-sol', status:'completed', output:[{type:'message', content:[{type:'output_text', text:'hi'}]}], usage:{input_tokens:3, output_tokens:2, total_tokens:5}}`. Client posts `{model:'gpt-6.1-sol', messages:[{role:'user',content:'hi'}], tools:[TOOL], stream:false}`. Assert `res.status === 200`, body `object === 'chat.completion'`, `choices[0].message.content === 'hi'`, `usage.prompt_tokens === 3`, and the bridge request body has `instructions === undefined`, `tools[0]` in Responses shape (`{type:'function', name:'ping', ...}`), no `reasoning`, and no `temperature` (client sent `temperature: 0.2`).
2. `it('bridges a streamed answer into chat chunks and ends with done')` — same 400, then `/v1/responses` replies `content-type: text/event-stream` with `SSE_BODY`; client sends `stream: true`; assert the raw text contains `"object":"chat.completion.chunk"`, contains `hi`, ends with `data: [DONE]\n\n`, and that the request to `/v1/responses` carried `stream: true`.
3. `it('does not bridge a request without tools')` — upstream answers 400 `NONE_ERROR`; client sends no tools; assert status 400, body `error.message` unchanged, and exactly one upstream request.
4. `it('bridges only once')` — upstream answers 400 `TOOLS_ERROR`, then 400 `NONE_ERROR`, then records any third call; assert status 400, the last body returned is the `NONE_ERROR` payload, and total chat requests are 2 plus exactly one `/v1/responses` request.
5. `it('returns the original 400 when the bridge endpoint is missing')` — upstream answers 400 `NONE_ERROR`, and `/v1/responses` replies 404 with `content-type: text/html` and `<html>nope</html>`; assert status 400 and body equals `NONE_ERROR`.
6. `it('preserves the client reasoning effort through the bridge')` — 400 `TOOLS_ERROR`, client sends `reasoning_effort:'high'` with tools; assert the `/v1/responses` body has `reasoning: {effort:'high'}`.
7. `it('surfaces a failed responses status as an error')` — bridge returns 200 JSON `{id:'resp_1', status:'failed', error:{message:'model exploded'}}`; assert status 502 and body `error.message === 'model exploded'`.
8. `it('forwards a bridge upstream failure')` — 400 `NONE_ERROR`, then `/v1/responses` replies 500 JSON `{error:{message:'bridge down', type:'api_error'}}`; assert status 500 and body `error.message === 'bridge down'` (a JSON bridge error is relayed verbatim).
9. `it('tears down the bridge stream when the client aborts')` — 400 `NONE_ERROR`, then `/v1/responses` writes one SSE frame and hangs, resolving a promise from `res.on('close', () => resolve(!res.writableEnded))`; the client aborts after its first data event (same shape as the existing "closes the upstream response when the client aborts mid-stream" test, using `http.request` and `withTimeout`); assert the bridge upstream saw a premature close.

- [ ] **Step 5: Run the new tests and watch them fail**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts -t "chat completions to responses bridge"`
Expected: FAIL — the proxy passes the 400 through (no bridge yet).

- [ ] **Step 6: Implement the bridge in `startOpenAIParamProxy`**

Keep the existing flow (rewrite → upstream → buffered 400 inspection → `max_tokens` retry → `none` retry). Add:
- `const originalReasoningEffort = parsed.reasoning_effort;` next to `parsedRequest` when the body is parsed.
- `const hasTools = Array.isArray(parsedRequest?.tools) && parsedRequest.tools.length > 0;`
- `let bridged = false;`
- In the 400 branch, after the two existing retries and before passing the body through: when `!bridged && hasTools && parsedRequest !== undefined && (isToolsReasoningUnsupportedError(parsedBody) || isReasoningEffortValueUnsupportedError(parsedBody))`, set `bridged = true` and call `sendViaBridge(parsedRequest, parsedBody, raw)`.

`sendViaBridge` (nested in the handler, so it closes over `headers`, `upstream`, `upstreamModule`, `res`, `req`, `timeoutMs`):
1. Build the Responses body with `convertChatRequestToResponses(request, { originalReasoningEffort })`, stringify it, set `bridgeHeaders = { ...headers }` (this keeps `authorization`), set `content-length` to the new length, set `accept-encoding: 'identity'`, and target `new URL(responsesEndpointPath(targetUrl.pathname) + targetUrl.search, upstream.origin)`.
2. On non-2xx: buffer the body; if it parses as JSON with `error`, forward its status and body; otherwise forward the original `raw` 400 (status `proxyRes.statusCode` of the first attempt) so the "use /v1/responses" hint survives.
3. On 2xx JSON: `convertResponsesToChatResponse(parsed, request.model)`. If the response `status === 'failed'` or it carries a top-level `error`, reply 502 with `{error:{message, type:'api_error'}}` instead. Reply with `content-length` recomputed and `content-type: application/json`.
4. On 2xx `text/event-stream`: if `request.stream` is true, stream translated frames: split on `\n\n`, parse `data: ` lines (follow the local `sseLineToEvent` helper pattern in `responses-proxy.ts`), create `const chunkState = createChatStreamState('chatcmpl-' + Date.now(), request.model, Math.floor(Date.now() / 1000))`, then write `data: ${JSON.stringify(obj)}\n\n` for every object returned by `convertResponsesEventToChatChunks(event, chunkState)` and finish with `data: [DONE]\n\n`. If the request was non-stream, buffer all events and use `responsesSseToChatResponse(events, request.model)` and reply as JSON.
5. If `request.stream` is true but the upstream sent JSON, use `chatCompletionToStreamChunks(converted)` and emit the same chunk framing plus `[DONE]`.
6. Mirror the existing lifecycle guards: `bridgeReq.setTimeout(timeoutMs, …)`, destroy `bridgeReq` on `req.on('error')`, and on the streamed path destroy the bridge upstream response from `res.on('close')` when `!res.writableEnded && !bridgeRes.destroyed` (the same guard the pass-through path uses), so a client abort stops the paid request.

- [ ] **Step 7: Run the bridge tests**

Run: `npx vitest run src/proxy/openai-param-proxy.test.ts`
Expected: PASS, including the pre-existing passthrough tests.

- [ ] **Step 8: Run the whole proxy suite**

Run: `npx vitest run src/proxy`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/proxy/openai-param-proxy.ts src/proxy/openai-param-proxy.test.ts
git commit -m "fix(proxy): replay chat completions through the responses API when tools are rejected"
```

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `AGENTS.md` (Qwen row in "Поддерживаемые агенты", the "Qwen parameter proxy" subsection), `README.md` and `README.ru.md` (Qwen bullet), `CHANGELOG.md` (`[Unreleased] → Fixed`)

**Interfaces:**
- Consumes: behaviour from Tasks 1–4.
- Produces: no code.

- [ ] **Step 1: Update `AGENTS.md`**

In the Qwen parameter proxy subsection, after the `max_tokens` description, add: when a request carries `tools` and the upstream rejects the pair (400 "Function tools with reasoning_effort are not supported" or "reasoning_effort does not support 'none'"), the proxy replays the request once through `<baseUrl>/responses` via `src/proxy/chat-responses-adapter.ts`, translates the answer (JSON or SSE with tool calls) back to Chat Completions, drops sampling parameters the Responses API rejects, omits `reasoning_effort: none`, and forces `accept-encoding: identity` upstream so buffered 400 bodies stay readable. Note the one-attempt limit and the fallback to the original 400. Update the Claude Code row only if it changed (it did not).

- [ ] **Step 2: Update both READMEs**

Extend the Qwen bullet with one sentence: for gpt-6+ models that refuse function tools on Chat Completions (sol/astra), the same proxy retries through `/v1/responses` and keeps tools working. Keep the Russian and English wording equivalent.

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `[Unreleased] → Fixed`: "Qwen CLI: gpt-6+ reasoning-only models (`gpt-6.1-sol`, `gpt-6-astra`) now work with function tools — the parameter proxy replays the request through `/v1/responses` and translates the streamed answer back to Chat Completions."

- [ ] **Step 4: Full verification**

Run: `npm run typecheck`
Expected: no output, exit 0.

Run: `npm test`
Expected: all suites pass.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build && node dist/bin/agento.js --version`
Expected: prints the version.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md README.md README.ru.md CHANGELOG.md
git commit -m "docs: describe the qwen chat completions to responses bridge"
```
