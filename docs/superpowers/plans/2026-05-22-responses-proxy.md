# Responses-Compatible Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `responses-compatible` provider type to agento's claude-code adapter by implementing a proxy that translates Anthropic `/v1/messages` ↔ OpenAI Responses API `/v1/responses`.

**Architecture:** New `responses-adapter.ts` contains pure conversion functions (no HTTP). New `responses-proxy.ts` is a thin HTTP server that uses the adapter, mirroring the existing `openai-proxy.ts` / `openai-adapter.ts` pattern. `claude-code.ts` and `transaction.ts` get minimal integration wiring.

**Tech Stack:** Node.js built-in `http`/`https`, TypeScript, Vitest. No new dependencies.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/proxy/responses-adapter.ts` | Pure conversion: Anthropic ↔ Responses API |
| Create | `src/proxy/responses-adapter.test.ts` | Unit tests for adapter functions |
| Create | `src/proxy/responses-proxy.ts` | HTTP proxy server |
| Create | `src/proxy/responses-proxy.test.ts` | Integration tests for proxy |
| Modify | `src/adapters/claude-code.ts:36` | Add `responses-compatible` to supportedProviderTypes, handle in buildConfig |
| Modify | `src/adapters/claude-code.test.ts` | Tests for new provider type |
| Modify | `src/launcher/transaction.ts:5-7,142-146` | Import + start responses proxy branch |
| Modify | `src/launcher/transaction.test.ts` | Test for responses proxy dispatch |

---

## Task 1: responses-adapter.ts — Request Conversion

**Files:**
- Create: `src/proxy/responses-adapter.ts`
- Create: `src/proxy/responses-adapter.test.ts`

- [ ] **Step 1.1: Write failing tests for `convertRequest`**

Create `src/proxy/responses-adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  convertRequest,
  convertResponse,
  convertError,
  createStreamState,
  convertStreamChunk,
} from './responses-adapter.js';

describe('convertRequest', () => {
  it('converts simple user text message', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
    });
    expect(result.model).toBe('gpt-4o');
    expect(result.max_output_tokens).toBe(100);
    expect(result.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
    ]);
  });

  it('converts system to instructions', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10,
      system: 'Be concise',
    });
    expect(result.instructions).toBe('Be concise');
  });

  it('converts tools: input_schema → parameters with type:function', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [],
      max_tokens: 1,
      tools: [
        {
          name: 'bash',
          description: 'Run shell commands',
          input_schema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
        },
      ],
    });
    expect(result.tools).toEqual([
      {
        type: 'function',
        name: 'bash',
        description: 'Run shell commands',
        parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
      },
    ]);
  });

  it('converts thinking budget_tokens < 2000 → reasoning effort low', () => {
    const result = convertRequest({
      model: 'o3',
      messages: [],
      max_tokens: 1000,
      thinking: { type: 'enabled', budget_tokens: 1500 },
    });
    expect(result.reasoning).toEqual({ effort: 'low' });
  });

  it('converts thinking budget_tokens 2000–9999 → reasoning effort medium', () => {
    const result = convertRequest({
      model: 'o3',
      messages: [],
      max_tokens: 1000,
      thinking: { type: 'enabled', budget_tokens: 5000 },
    });
    expect(result.reasoning).toEqual({ effort: 'medium' });
  });

  it('converts thinking budget_tokens ≥ 10000 → reasoning effort high', () => {
    const result = convertRequest({
      model: 'o3',
      messages: [],
      max_tokens: 1000,
      thinking: { type: 'enabled', budget_tokens: 10000 },
    });
    expect(result.reasoning).toEqual({ effort: 'high' });
  });

  it('converts user message with tool_result to function_call_output top-level item', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'Paris' },
          ],
        },
      ],
      max_tokens: 10,
    });
    expect(result.input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'Paris' },
    ]);
  });

  it('converts user message with mixed text and tool_result', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'ok' },
            { type: 'text', text: 'Now summarize.' },
          ],
        },
      ],
      max_tokens: 10,
    });
    expect(result.input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now summarize.' }] },
    ]);
  });

  it('converts assistant tool_use to function_call top-level item', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
          ],
        },
      ],
      max_tokens: 10,
    });
    expect(result.input).toEqual([
      { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' },
    ]);
  });

  it('converts mixed assistant message: text before tool_use produces message item then function_call', () => {
    const result = convertRequest({
      model: 'gpt-4o',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Sure.' },
            { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
          ],
        },
      ],
      max_tokens: 10,
    });
    expect(result.input).toEqual([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Sure.' }] },
      { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{"cmd":"ls"}' },
    ]);
  });
});
```

- [ ] **Step 1.2: Create stub `responses-adapter.ts` so tests can be imported (all exports present, implementation TODO)**

Create `src/proxy/responses-adapter.ts`:

```ts
/** Type guard for plain objects. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Converts an Anthropic /v1/messages request body into a Responses API request body. */
export function convertRequest(req: Record<string, unknown>): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = [];
  const messages = Array.isArray(req.messages) ? req.messages : [];

  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const role = String(msg.role ?? '');
    const content = msg.content;

    if (role === 'user') {
      if (typeof content === 'string') {
        input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] });
      } else if (Array.isArray(content)) {
        const textParts: Array<Record<string, unknown>> = [];
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text') {
            textParts.push({ type: 'input_text', text: String(block.text ?? '') });
          } else if (block.type === 'tool_result') {
            // tool_results become top-level function_call_output items
            let output: string;
            try {
              output = typeof block.content === 'string'
                ? block.content
                : (block.content === undefined ? '' : JSON.stringify(block.content));
            } catch {
              output = '';
            }
            if (textParts.length > 0) {
              input.push({ type: 'message', role: 'user', content: [...textParts] });
              textParts.length = 0;
            }
            input.push({ type: 'function_call_output', call_id: String(block.tool_use_id ?? ''), output });
          }
        }
        if (textParts.length > 0) {
          input.push({ type: 'message', role: 'user', content: textParts });
        }
      }
    } else if (role === 'assistant') {
      if (typeof content === 'string') {
        input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] });
      } else if (Array.isArray(content)) {
        const textParts: Array<Record<string, unknown>> = [];
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text') {
            textParts.push({ type: 'output_text', text: String(block.text ?? '') });
          } else if (block.type === 'tool_use') {
            if (textParts.length > 0) {
              input.push({ type: 'message', role: 'assistant', content: [...textParts] });
              textParts.length = 0;
            }
            let args: string;
            try {
              args = JSON.stringify(block.input ?? {});
            } catch {
              args = '{}';
            }
            input.push({
              type: 'function_call',
              call_id: String(block.id ?? ''),
              name: String(block.name ?? ''),
              arguments: args,
            });
          }
        }
        if (textParts.length > 0) {
          input.push({ type: 'message', role: 'assistant', content: textParts });
        }
      }
    }
  }

  const result: Record<string, unknown> = {
    model: String(req.model ?? ''),
    input,
    stream: req.stream,
  };

  if (typeof req.max_tokens === 'number') result.max_output_tokens = req.max_tokens;
  if (typeof req.temperature === 'number') result.temperature = req.temperature;
  if (typeof req.system === 'string') result.instructions = req.system;
  if (Array.isArray(req.tools)) result.tools = (req.tools as Array<Record<string, unknown>>).map(convertTool);

  if (isRecord(req.thinking) && req.thinking.type === 'enabled') {
    const budget = typeof req.thinking.budget_tokens === 'number' ? req.thinking.budget_tokens : 0;
    result.reasoning = { effort: budget < 2000 ? 'low' : budget < 10000 ? 'medium' : 'high' };
  }

  return result;
}

function convertTool(tool: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  };
}

/** Converts a Responses API response body into an Anthropic /v1/messages response body. */
export function convertResponse(res: unknown): Record<string, unknown> {
  throw new Error('not implemented');
}

/** Converts an error into Anthropic error format. */
export function convertError(err: unknown): Record<string, unknown> {
  throw new Error('not implemented');
}

/** Mutable state for streaming a Responses API SSE stream into Anthropic SSE events. */
export interface StreamState {
  id: string;
  model: string;
  initialized: boolean;
  /** Maps output_index (or '__reasoning__') → Anthropic content_block index. */
  itemIndexMap: Map<number | string, number>;
  nextBlockIndex: number;
  inputTokens: number;
  outputTokens: number;
}

/** Create a fresh StreamState for a new streaming session. */
export function createStreamState(id: string, model: string): StreamState {
  throw new Error('not implemented');
}

/** Convert one Responses API SSE event into zero or more Anthropic SSE event objects. */
export function convertStreamChunk(event: Record<string, unknown>, state: StreamState): Array<Record<string, unknown>> {
  throw new Error('not implemented');
}
```

- [ ] **Step 1.3: Run failing tests to verify they fail as expected**

```bash
npx vitest run src/proxy/responses-adapter.test.ts
```

Expected: `convertRequest` tests pass (implementation is complete), `convertResponse`/streaming tests fail with "not implemented".

- [ ] **Step 1.4: Commit request conversion**

```bash
git add src/proxy/responses-adapter.ts src/proxy/responses-adapter.test.ts
git commit -m "feat(proxy): add responses-adapter convertRequest"
```

---

## Task 2: responses-adapter.ts — Response Conversion + Error

**Files:**
- Modify: `src/proxy/responses-adapter.ts`
- Modify: `src/proxy/responses-adapter.test.ts`

- [ ] **Step 2.1: Add failing tests for `convertResponse` and `convertError`**

Append to `src/proxy/responses-adapter.test.ts`:

```ts
describe('convertResponse', () => {
  it('converts text output to Anthropic message', () => {
    const result = convertResponse({
      id: 'resp_abc',
      model: 'gpt-4o',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello world' }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(result.id).toBe('resp_abc');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(result.stop_reason).toBe('end_turn');
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('converts function_call output to tool_use', () => {
    const result = convertResponse({
      id: 'resp_xyz',
      model: 'gpt-4o',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'bash',
          arguments: '{"cmd":"ls"}',
        },
      ],
      usage: { input_tokens: 8, output_tokens: 3 },
    });
    expect(result.stop_reason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'bash', input: { cmd: 'ls' } },
    ]);
  });

  it('stop_reason is end_turn when no function_call in output', () => {
    const result = convertResponse({
      id: 'r',
      model: 'm',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(result.stop_reason).toBe('end_turn');
  });

  it('stop_reason is tool_use when function_call present', () => {
    const result = convertResponse({
      id: 'r',
      model: 'm',
      output: [{ type: 'function_call', call_id: 'c1', name: 'read', arguments: '{}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(result.stop_reason).toBe('tool_use');
  });
});

describe('convertError', () => {
  it('wraps string error', () => {
    const result = convertError('bad input');
    expect(result).toEqual({ type: 'error', error: { type: 'api_error', message: 'bad input' } });
  });

  it('extracts error.message from object', () => {
    const result = convertError({ error: { type: 'invalid_request_error', message: 'No model' } });
    expect(result).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'No model' } });
  });

  it('handles unknown object', () => {
    const result = convertError({ message: 'Something failed' });
    expect(result.type).toBe('error');
  });
});
```

- [ ] **Step 2.2: Implement `convertResponse` and `convertError` in `responses-adapter.ts`**

Replace the stub `convertResponse` and `convertError` functions:

```ts
/** Converts a Responses API response body into an Anthropic /v1/messages response body. */
export function convertResponse(res: unknown): Record<string, unknown> {
  if (!isRecord(res)) throw new Error('Invalid response body');
  const content: Array<Record<string, unknown>> = [];
  const output = Array.isArray(res.output) ? res.output : [];
  let hasToolUse = false;

  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const part of parts) {
        if (!isRecord(part)) continue;
        if (part.type === 'output_text') {
          content.push({ type: 'text', text: String(part.text ?? '') });
        }
      }
    } else if (item.type === 'function_call') {
      hasToolUse = true;
      let input: unknown = {};
      try {
        input = JSON.parse(String(item.arguments ?? '{}'));
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: String(item.call_id ?? item.id ?? ''),
        name: String(item.name ?? ''),
        input,
      });
    }
  }

  const rawUsage = isRecord(res.usage) ? res.usage : undefined;
  return {
    id: String(res.id ?? ''),
    type: 'message',
    role: 'assistant',
    content,
    model: String(res.model ?? ''),
    stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: typeof rawUsage?.input_tokens === 'number' ? rawUsage.input_tokens : 0,
      output_tokens: typeof rawUsage?.output_tokens === 'number' ? rawUsage.output_tokens : 0,
    },
  };
}

/** Converts an error into Anthropic error format. */
export function convertError(err: unknown): Record<string, unknown> {
  if (typeof err === 'string') return { type: 'error', error: { type: 'api_error', message: err } };
  if (!isRecord(err)) return { type: 'error', error: { type: 'api_error', message: String(err) } };
  if (isRecord(err.error)) {
    const inner = err.error;
    return {
      type: 'error',
      error: {
        type: String(inner.type ?? 'api_error'),
        message: String(inner.message ?? 'Unknown error'),
      },
    };
  }
  return { type: 'error', error: { type: 'api_error', message: String(err.message ?? 'Unknown error') } };
}
```

- [ ] **Step 2.3: Run tests**

```bash
npx vitest run src/proxy/responses-adapter.test.ts
```

Expected: all `convertRequest`, `convertResponse`, `convertError` tests pass.

- [ ] **Step 2.4: Commit**

```bash
git add src/proxy/responses-adapter.ts src/proxy/responses-adapter.test.ts
git commit -m "feat(proxy): add responses-adapter convertResponse and convertError"
```

---

## Task 3: responses-adapter.ts — Streaming

**Files:**
- Modify: `src/proxy/responses-adapter.ts`
- Modify: `src/proxy/responses-adapter.test.ts`

- [ ] **Step 3.1: Add failing tests for streaming**

Append to `src/proxy/responses-adapter.test.ts`:

```ts
describe('createStreamState', () => {
  it('initializes with correct defaults', () => {
    const state = createStreamState('resp_1', 'gpt-4o');
    expect(state.id).toBe('resp_1');
    expect(state.model).toBe('gpt-4o');
    expect(state.initialized).toBe(false);
    expect(state.nextBlockIndex).toBe(0);
    expect(state.inputTokens).toBe(0);
    expect(state.outputTokens).toBe(0);
    expect(state.itemIndexMap.size).toBe(0);
  });
});

describe('convertStreamChunk', () => {
  it('emits message_start on first chunk (any type)', () => {
    const state = createStreamState('resp_1', 'gpt-4o');
    const events = convertStreamChunk({ type: 'response.created', response: {} }, state);
    expect(events[0].type).toBe('message_start');
    const msg = events[0].message as Record<string, unknown>;
    expect(msg.id).toBe('resp_1');
    expect(msg.role).toBe('assistant');
    expect(state.initialized).toBe(true);
  });

  it('message_start only emits once even across multiple chunks', () => {
    const state = createStreamState('resp_1', 'gpt-4o');
    convertStreamChunk({ type: 'response.created', response: {} }, state);
    const events2 = convertStreamChunk({ type: 'response.created', response: {} }, state);
    expect(events2.some((e) => e.type === 'message_start')).toBe(false);
  });

  it('response.output_item.added (type=message) → content_block_start text', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    const events = convertStreamChunk({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', role: 'assistant' },
    }, state);
    expect(events).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ]);
    expect(state.itemIndexMap.get(0)).toBe(0);
  });

  it('response.output_item.added (type=function_call) → content_block_start tool_use', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    const events = convertStreamChunk({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '' },
    }, state);
    expect(events).toEqual([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'call_1', name: 'bash', input: {} },
      },
    ]);
  });

  it('response.output_text.delta → content_block_delta text_delta', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    state.itemIndexMap.set(0, 0);
    state.nextBlockIndex = 1;
    const events = convertStreamChunk({
      type: 'response.output_text.delta',
      output_index: 0,
      delta: 'Hello',
    }, state);
    expect(events).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    ]);
    expect(state.outputTokens).toBe(1);
  });

  it('response.function_call_arguments.delta → content_block_delta input_json_delta', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    state.itemIndexMap.set(0, 0);
    state.nextBlockIndex = 1;
    const events = convertStreamChunk({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"cmd":',
    }, state);
    expect(events).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":' } },
    ]);
  });

  it('response.output_item.done → content_block_stop', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    state.itemIndexMap.set(0, 0);
    state.nextBlockIndex = 1;
    const events = convertStreamChunk({ type: 'response.output_item.done', output_index: 0 }, state);
    expect(events).toEqual([{ type: 'content_block_stop', index: 0 }]);
  });

  it('response.completed → message_delta + message_stop with end_turn', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    const events = convertStreamChunk({
      type: 'response.completed',
      response: {
        output: [{ type: 'message', role: 'assistant', content: [] }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }, state);
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_delta' }));
    expect(events).toContainEqual({ type: 'message_stop' });
    const delta = events.find((e) => e.type === 'message_delta') as Record<string, unknown>;
    expect((delta.delta as Record<string, unknown>).stop_reason).toBe('end_turn');
    expect(state.inputTokens).toBe(10);
  });

  it('response.completed with function_call output → stop_reason tool_use', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    const events = convertStreamChunk({
      type: 'response.completed',
      response: {
        output: [{ type: 'function_call', call_id: 'c1', name: 'bash', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    }, state);
    const delta = events.find((e) => e.type === 'message_delta') as Record<string, unknown>;
    expect((delta.delta as Record<string, unknown>).stop_reason).toBe('tool_use');
  });

  it('response.reasoning_summary_text.delta → thinking content_block_start + delta', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    const events = convertStreamChunk({
      type: 'response.reasoning_summary_text.delta',
      delta: 'Let me think...',
    }, state);
    expect(events[0]).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    });
    expect(events[1]).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Let me think...' },
    });
  });

  it('response.reasoning_summary_text.delta reuses same block on second call', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    convertStreamChunk({ type: 'response.reasoning_summary_text.delta', delta: 'part1' }, state);
    const events2 = convertStreamChunk({ type: 'response.reasoning_summary_text.delta', delta: 'part2' }, state);
    // second call: no content_block_start, just delta
    expect(events2).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'part2' } },
    ]);
  });

  it('response.completed closes open reasoning block', () => {
    const state = createStreamState('r', 'm');
    state.initialized = true;
    convertStreamChunk({ type: 'response.reasoning_summary_text.delta', delta: 'think' }, state);
    const events = convertStreamChunk({
      type: 'response.completed',
      response: { output: [], usage: { input_tokens: 1, output_tokens: 1 } },
    }, state);
    expect(events[0]).toEqual({ type: 'content_block_stop', index: 0 });
    expect(events[1].type).toBe('message_delta');
    expect(events[2].type).toBe('message_stop');
  });
});
```

- [ ] **Step 3.2: Implement `createStreamState` and `convertStreamChunk` in `responses-adapter.ts`**

Replace the stub `createStreamState` and `convertStreamChunk`:

```ts
/** Create a fresh StreamState for a new streaming session. */
export function createStreamState(id: string, model: string): StreamState {
  return {
    id,
    model,
    initialized: false,
    itemIndexMap: new Map(),
    nextBlockIndex: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Convert one Responses API SSE event into zero or more Anthropic SSE event objects. Mutates state. */
export function convertStreamChunk(event: Record<string, unknown>, state: StreamState): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const type = String(event.type ?? '');

  if (!state.initialized) {
    state.initialized = true;
    out.push({
      type: 'message_start',
      message: {
        id: state.id,
        type: 'message',
        role: 'assistant',
        model: state.model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  switch (type) {
    case 'response.output_item.added': {
      const item = isRecord(event.item) ? event.item : {};
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : state.nextBlockIndex;
      const itemType = String(item.type ?? '');
      const blockIndex = state.nextBlockIndex++;
      state.itemIndexMap.set(outputIndex, blockIndex);

      if (itemType === 'message') {
        out.push({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
      } else if (itemType === 'function_call') {
        out.push({
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: String(item.call_id ?? item.id ?? ''),
            name: String(item.name ?? ''),
            input: {},
          },
        });
      }
      break;
    }

    case 'response.output_text.delta': {
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : -1;
      const blockIndex = state.itemIndexMap.get(outputIndex);
      if (blockIndex !== undefined) {
        out.push({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: String(event.delta ?? '') },
        });
        state.outputTokens += 1;
      }
      break;
    }

    case 'response.function_call_arguments.delta': {
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : -1;
      const blockIndex = state.itemIndexMap.get(outputIndex);
      if (blockIndex !== undefined) {
        out.push({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: String(event.delta ?? '') },
        });
        state.outputTokens += 1;
      }
      break;
    }

    case 'response.reasoning_summary_text.delta': {
      const REASONING_KEY = '__reasoning__';
      let blockIndex = state.itemIndexMap.get(REASONING_KEY);
      if (blockIndex === undefined) {
        blockIndex = state.nextBlockIndex++;
        state.itemIndexMap.set(REASONING_KEY, blockIndex);
        out.push({ type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking', thinking: '' } });
      }
      out.push({
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: String(event.delta ?? '') },
      });
      break;
    }

    case 'response.output_item.done': {
      const outputIndex = typeof event.output_index === 'number' ? event.output_index : -1;
      const blockIndex = state.itemIndexMap.get(outputIndex);
      if (blockIndex !== undefined) {
        out.push({ type: 'content_block_stop', index: blockIndex });
      }
      break;
    }

    case 'response.completed': {
      const reasoningBlockIndex = state.itemIndexMap.get('__reasoning__');
      if (reasoningBlockIndex !== undefined) {
        out.push({ type: 'content_block_stop', index: reasoningBlockIndex });
      }

      const response = isRecord(event.response) ? event.response : {};
      const rawUsage = isRecord(response.usage) ? response.usage : undefined;
      if (rawUsage) {
        if (typeof rawUsage.input_tokens === 'number') state.inputTokens = rawUsage.input_tokens;
        if (typeof rawUsage.output_tokens === 'number') state.outputTokens = rawUsage.output_tokens;
      }

      const responseOutput = Array.isArray(response.output) ? response.output : [];
      const hasToolUse = responseOutput.some((item: unknown) => isRecord(item) && item.type === 'function_call');

      out.push({
        type: 'message_delta',
        delta: { stop_reason: hasToolUse ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: state.outputTokens },
      });
      out.push({ type: 'message_stop' });
      break;
    }
  }

  return out;
}
```

- [ ] **Step 3.3: Run all adapter tests**

```bash
npx vitest run src/proxy/responses-adapter.test.ts
```

Expected: all tests pass.

- [ ] **Step 3.4: Commit complete adapter**

```bash
git add src/proxy/responses-adapter.ts src/proxy/responses-adapter.test.ts
git commit -m "feat(proxy): complete responses-adapter with streaming support"
```

---

## Task 4: responses-proxy.ts — HTTP Proxy Server

**Files:**
- Create: `src/proxy/responses-proxy.ts`
- Create: `src/proxy/responses-proxy.test.ts`

- [ ] **Step 4.1: Write integration tests**

Create `src/proxy/responses-proxy.test.ts`:

```ts
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
      res.end(JSON.stringify({
        id: 'resp_1',
        model: 'gpt-4o',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }));
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 100 }),
    });
    expect(res.status).toBe(200);
    expect(receivedUrl).toBe('/v1/responses');
    const received = receivedBody as Record<string, unknown>;
    expect(received.max_output_tokens).toBe(100);
    expect(Array.isArray(received.input)).toBe(true);
    const body = await res.json() as Record<string, unknown>;
    expect(body.content).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(body.stop_reason).toBe('end_turn');
  });

  it('translates streaming /v1/messages SSE response', async () => {
    upstream.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}\n\n');
      res.write('data: {"type":"response.output_text.delta","output_index":0,"delta":"Hi"}\n\n');
      res.write('data: {"type":"response.output_item.done","output_index":0}\n\n');
      res.write('data: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[]}],"usage":{"input_tokens":5,"output_tokens":1}}}\n\n');
      res.end();
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, stream: true }),
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
      res.end(JSON.stringify({ error: { message: 'Invalid model', type: 'invalid_request_error' } }));
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'bad', messages: [], max_tokens: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
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
    upstream.on('request', () => { /* hang */ });
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
      res.end(JSON.stringify({
        id: 'r', model: 'm',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] }],
        usage: { input_tokens: 0, output_tokens: 0 },
      }));
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
      res.write('data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}\n\n');
      // leave hanging so client can abort
    });
    proxy = await startResponsesProxy({ upstreamUrl });
    const controller = new AbortController();
    try {
      const fetchProm = fetch(`${proxy.url}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, stream: true }),
        signal: controller.signal,
      });
      controller.abort();
      await fetchProm;
    } catch {
      // AbortError is expected
    }
    // Verify proxy is still alive
    upstream.removeAllListeners('request');
    upstream.on('request', (_req, res) => { res.writeHead(200); res.end('ok'); });
    const health = await fetch(`${proxy.url}/v1/models`);
    expect(health.status).toBe(200);
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they fail (file not yet created)**

```bash
npx vitest run src/proxy/responses-proxy.test.ts
```

Expected: FAIL — `startResponsesProxy` not found.

- [ ] **Step 4.3: Create `src/proxy/responses-proxy.ts`**

```ts
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  convertRequest,
  convertResponse,
  convertError,
  createStreamState,
  convertStreamChunk,
} from './responses-adapter.js';
import { buildProxyHeaders, getOutboundAgent, normalizeProxyUpstream } from './proxy-utils.js';

/** Options for starting the Responses-API-to-Anthropic proxy server. */
export interface ResponsesProxyOptions {
  upstreamUrl: string;
  port?: number;
  /** Milliseconds before destroying a stalled upstream request. Default: 120_000. */
  timeoutMs?: number;
}

/** Running proxy server handle. */
export interface ProxyServer {
  url: string;
  stop: () => Promise<void>;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
  }
  return Buffer.concat(chunks);
}

function isJsonRequest(req: http.IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return typeof ct === 'string' && ct.includes('application/json');
}

/** Parse an SSE block (text between \n\n separators) into zero or more JSON events. */
function sseLineToEvent(block: string): Array<Record<string, unknown>> {
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6);
    if (payload === '[DONE]') return [];
    try {
      return [JSON.parse(payload)];
    } catch {
      return [];
    }
  }
  return [];
}

/** Start an HTTP proxy that translates Anthropic /v1/messages requests to Responses API upstream. */
export async function startResponsesProxy(options: ResponsesProxyOptions): Promise<ProxyServer> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const upstream = new URL(normalizeProxyUpstream(options.upstreamUrl));
  const upstreamModule = upstream.protocol === 'https:' ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? '/', 'http://localhost');
      const targetUrl = new URL(upstream);
      let upstreamPath = upstream.pathname.replace(/\/+$/, '');
      const reqPath = reqUrl.pathname;

      const isMessagesEndpoint = reqPath === '/v1/messages' || reqPath === '/v1/messages/';
      let resolvedPath = reqPath;
      if (isMessagesEndpoint) {
        resolvedPath = '/v1/responses';
      }

      if (resolvedPath.startsWith('/v1/') && upstreamPath.endsWith('/v1')) {
        upstreamPath = upstreamPath.slice(0, -3);
      }

      targetUrl.pathname = upstreamPath + resolvedPath;
      targetUrl.search = reqUrl.search;

      let body: Buffer | undefined;
      const shouldRewrite = req.method === 'POST' && isJsonRequest(req) && isMessagesEndpoint;

      if (shouldRewrite) {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            const parsed = JSON.parse(raw.toString('utf-8'));
            const converted = convertRequest(parsed);
            body = Buffer.from(JSON.stringify(converted), 'utf-8');
          } catch {
            body = raw;
          }
        }
      }

      const headers = buildProxyHeaders(req.headers, body?.length);

      const proxyReq = upstreamModule.request(
        targetUrl,
        { method: req.method, headers, agent: getOutboundAgent(upstream) },
        (proxyRes) => {
          const contentType = proxyRes.headers['content-type'];
          const ct = Array.isArray(contentType) ? contentType[0] : contentType;
          const isStream = typeof ct === 'string' && ct.includes('text/event-stream');
          const isJson = typeof ct === 'string' && ct.includes('application/json');
          const statusOk = (proxyRes.statusCode ?? 200) >= 200 && (proxyRes.statusCode ?? 200) < 300;

          if (isMessagesEndpoint && statusOk) {
            if (isStream) {
              const streamHeaders = { ...proxyRes.headers };
              delete streamHeaders['content-length'];
              delete streamHeaders['transfer-encoding'];
              res.writeHead(proxyRes.statusCode ?? 200, { ...streamHeaders, 'content-type': 'text/event-stream' });
              const state = createStreamState('resp-proxy-' + Date.now(), 'unknown');
              let buffer = '';
              proxyRes.on('data', (chunk) => {
                buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop() ?? '';
                for (const block of blocks) {
                  for (const event of sseLineToEvent(block)) {
                    for (const ev of convertStreamChunk(event, state)) {
                      res.write(`event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`);
                    }
                  }
                }
              });
              proxyRes.on('end', () => {
                if (buffer.trim()) {
                  for (const event of sseLineToEvent(buffer)) {
                    for (const ev of convertStreamChunk(event, state)) {
                      res.write(`event: ${String(ev.type ?? 'unknown')}\ndata: ${JSON.stringify(ev)}\n\n`);
                    }
                  }
                }
                res.end();
              });
              proxyRes.on('error', () => {
                if (!res.headersSent) res.writeHead(502);
                res.end();
              });
              req.on('close', () => {
                if (!proxyRes.destroyed) proxyRes.destroy();
              });
            } else if (isJson) {
              const chunks: Buffer[] = [];
              proxyRes.on('data', (chunk) => {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
              });
              proxyRes.on('end', () => {
                try {
                  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                  const converted = convertResponse(parsed);
                  const out = Buffer.from(JSON.stringify(converted), 'utf-8');
                  const responseHeaders = { ...proxyRes.headers };
                  delete responseHeaders['transfer-encoding'];
                  res.writeHead(proxyRes.statusCode ?? 200, { ...responseHeaders, 'content-length': out.length });
                  res.end(out);
                } catch {
                  res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                  res.end(Buffer.concat(chunks));
                }
              });
              proxyRes.on('error', (err) => {
                if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
                res.end(JSON.stringify(convertError(err instanceof Error ? err.message : String(err))));
              });
            } else {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
              proxyRes.pipe(res);
              proxyRes.on('error', () => {
                if (!res.headersSent) res.writeHead(502);
                res.end();
              });
            }
          } else if (isMessagesEndpoint && isJson) {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (chunk) => {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
            });
            proxyRes.on('end', () => {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                const out = Buffer.from(JSON.stringify(convertError(parsed)), 'utf-8');
                const responseHeaders = { ...proxyRes.headers };
                delete responseHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode ?? 200, { ...responseHeaders, 'content-length': out.length });
                res.end(out);
              } catch {
                res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
                res.end(Buffer.concat(chunks));
              }
            });
            proxyRes.on('error', (err) => {
              if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
              res.end(JSON.stringify(convertError(err instanceof Error ? err.message : String(err))));
            });
          } else {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
            proxyRes.on('error', () => {
              if (!res.headersSent) res.writeHead(502);
              res.end();
            });
          }
        },
      );

      proxyReq.setTimeout(timeoutMs, () => {
        proxyReq.destroy(new Error('upstream timeout'));
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify(convertError({ error: { message: err.message, type: 'bad_gateway' } })));
        }
      });

      req.on('error', () => {
        proxyReq.destroy();
      });

      if (body !== undefined) {
        proxyReq.end(body);
      } else {
        req.pipe(proxyReq);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify(convertError(err instanceof Error ? err.message : String(err))));
      }
    }
  });

  return new Promise<ProxyServer>((resolve, reject) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get proxy address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on('error', reject);
  });
}
```

- [ ] **Step 4.4: Run proxy tests**

```bash
npx vitest run src/proxy/responses-proxy.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.5: Run full proxy suite to check no regressions**

```bash
npx vitest run src/proxy/
```

Expected: all proxy tests pass.

- [ ] **Step 4.6: Commit proxy**

```bash
git add src/proxy/responses-proxy.ts src/proxy/responses-proxy.test.ts
git commit -m "feat(proxy): add responses-proxy HTTP server"
```

---

## Task 5: Integration — claude-code.ts + transaction.ts

**Files:**
- Modify: `src/adapters/claude-code.ts:36,83-89`
- Modify: `src/adapters/claude-code.test.ts`
- Modify: `src/launcher/transaction.ts:5-7,142-146`
- Modify: `src/launcher/transaction.test.ts`

- [ ] **Step 5.1: Write failing tests in `claude-code.test.ts`**

Open `src/adapters/claude-code.test.ts`.

**Update existing test at line 201** — the error message is changing from `'requires anthropic or openai mode'` to `'requires anthropic, openai, or responses mode'`. Update the test description and assertion:

Old:
```ts
  it('throws for custom-api provider without anthropic or openai mode', () => {
    // ...
    expect(() => adapter.buildConfig(profile, [customProvider])).toThrow('requires anthropic or openai mode');
  });
```

New:
```ts
  it('throws for custom-api provider without anthropic, openai, or responses mode', () => {
    // ...
    expect(() => adapter.buildConfig(profile, [customProvider])).toThrow('requires anthropic, openai, or responses mode');
  });
```

**Also add these new tests after the last existing test:**

```ts
  it('supportedProviderTypes includes responses-compatible', () => {
    expect(adapter.supportedProviderTypes).toContain('responses-compatible');
  });

  it('responses-compatible provider sets ANTHROPIC_BASE_URL to baseUrl', () => {
    const responsesProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'OpenAI Responses',
      type: 'responses-compatible',
      apiKey: 'sk-resp',
      baseUrl: 'https://api.openai.com',
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Responses Profile',
      models: [{ providerId: responsesProvider.id, model: 'gpt-4o' }],
    };
    const config = adapter.buildConfig(profile, [responsesProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.openai.com');
  });

  it('custom-api provider with responses mode sets ANTHROPIC_BASE_URL to baseUrl', () => {
    const customProvider: Provider = {
      id: '00000000-0000-0000-0000-000000000012',
      name: 'Custom Responses',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: true },
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000013',
      name: 'Custom Responses Profile',
      models: [{ providerId: customProvider.id, model: 'gpt-4o' }],
    };
    const config = adapter.buildConfig(profile, [customProvider]);
    const env = config.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
  });

```

- [ ] **Step 5.2: Run failing tests**

```bash
npx vitest run src/adapters/claude-code.test.ts
```

Expected: the four new tests fail.

- [ ] **Step 5.3: Modify `src/adapters/claude-code.ts`**

**Change 1** — Add `responses-compatible` to `supportedProviderTypes` (line 36):

Old:
```ts
readonly supportedProviderTypes = ['anthropic-compatible', 'fireworks', 'openrouter', 'custom-api', 'openai-compatible'] as const;
```

New:
```ts
readonly supportedProviderTypes = ['anthropic-compatible', 'fireworks', 'openrouter', 'custom-api', 'openai-compatible', 'responses-compatible'] as const;
```

**Change 2** — Handle `custom-api` responses mode and `responses-compatible` in `buildConfig` (lines 83–94):

Old:
```ts
    if (baseProvider.type === 'custom-api') {
      if (baseProvider.customApiModes?.anthropic) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'anthropic');
      } else if (baseProvider.customApiModes?.openai) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'openai');
      } else {
        throw new Error(`Claude Code requires anthropic or openai mode for custom-api provider "${baseProvider.name}"`);
      }
    } else {
      anthropicBase = baseProvider.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URLS[baseProvider.type];
    }
```

New:
```ts
    if (baseProvider.type === 'custom-api') {
      if (baseProvider.customApiModes?.anthropic) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'anthropic');
      } else if (baseProvider.customApiModes?.openai) {
        anthropicBase = resolveCustomApiUrl(baseProvider, 'openai');
      } else if (baseProvider.customApiModes?.responses) {
        anthropicBase = baseProvider.baseUrl; // proxy will rewrite /v1/messages → /v1/responses
      } else {
        throw new Error(`Claude Code requires anthropic, openai, or responses mode for custom-api provider "${baseProvider.name}"`);
      }
    } else {
      anthropicBase = baseProvider.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URLS[baseProvider.type];
    }
```

- [ ] **Step 5.4: Run claude-code tests**

```bash
npx vitest run src/adapters/claude-code.test.ts
```

Expected: all tests pass (including the four new ones).

- [ ] **Step 5.5: Write failing test in `transaction.test.ts`**

Open `src/launcher/transaction.test.ts`. Make these three additions:

**Addition A** — add vi.mock after line 30 (after the `anthropic-scrubber` mock):
```ts
vi.mock('../proxy/responses-proxy.js', () => ({
  startResponsesProxy: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:19999', stop: vi.fn() }),
}));
```

**Addition B** — add import after line 34 (after `startAnthropicScrubberProxy` import):
```ts
import { startResponsesProxy } from '../proxy/responses-proxy.js';
```

**Addition C** — add mock alias after line 42 (after `mockStartAnthropicScrubberProxy`):
```ts
const mockStartResponsesProxy = vi.mocked(startResponsesProxy);
```

Then add these test cases (after the existing `custom-api openai mode` test):

```ts
  it('starts responses proxy for responses-compatible provider with claude-code adapter', async () => {
    const responsesProvider: Provider = {
      id: 'p-responses',
      name: 'OpenAI Responses',
      type: 'responses-compatible',
      apiKey: 'sk-resp',
      baseUrl: 'https://api.openai.com',
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const responsesProfile: Profile = {
      id: 'prof-responses',
      name: 'Responses Profile',
      models: [{ providerId: responsesProvider.id, model: 'gpt-4o' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['responses-compatible'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://api.openai.com' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: responsesProfile,
      providers: [responsesProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartResponsesProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://api.openai.com' });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });

  it('starts responses proxy for custom-api provider with responses mode', async () => {
    const customProvider: Provider = {
      id: 'p-custom-resp',
      name: 'Custom Responses',
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://proxy.example.com',
      customApiModes: { openai: false, anthropic: false, responses: true },
      models: [{ name: 'gpt-4o', capabilities: { image: true, video: false, audio: false } }],
    };
    const customProfile: Profile = {
      id: 'prof-custom-resp',
      name: 'Custom Responses Profile',
      models: [{ providerId: customProvider.id, model: 'gpt-4o' }],
    };
    const adapter = makeAdapter(null);
    adapter.id = 'claude-code';
    adapter.displayName = 'Claude Code';
    adapter.supportedProviderTypes = ['custom-api'];
    adapter.buildConfig = vi.fn().mockReturnValue({
      env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    });

    await prepareLaunchTransaction({
      adapter,
      profile: customProfile,
      providers: [customProvider],
      scope: 'global',
      command: 'claude',
    });

    expect(mockStartResponsesProxy).toHaveBeenCalledWith({ upstreamUrl: 'https://proxy.example.com' });
    expect(mockStartOpenAIProxy).not.toHaveBeenCalled();
    expect(mockStartAnthropicScrubberProxy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5.6: Run failing transaction tests**

```bash
npx vitest run src/launcher/transaction.test.ts
```

Expected: new tests fail — `startResponsesProxy` is not imported/mocked.

- [ ] **Step 5.7: Modify `src/launcher/transaction.ts`**

**Change 1** — Add import at top (after `startOpenAIProxy` import, line 6):

```ts
import { startResponsesProxy } from '../proxy/responses-proxy.js';
```

**Change 2** — Add responses proxy branch in `maybeStartProxy` (around line 142):

Old:
```ts
  const needsOpenAIProxy = provider.type === 'openai-compatible'
    || (provider.type === 'custom-api' && provider.customApiModes?.openai && !provider.customApiModes?.anthropic);
  const proxy = needsOpenAIProxy
    ? await startOpenAIProxy({ upstreamUrl: upstream })
    : await startAnthropicScrubberProxy({ upstreamUrl: upstream });
```

New:
```ts
  const needsResponsesProxy = provider.type === 'responses-compatible'
    || (provider.type === 'custom-api' && !!provider.customApiModes?.responses && !provider.customApiModes?.anthropic && !provider.customApiModes?.openai);
  const needsOpenAIProxy = !needsResponsesProxy && (
    provider.type === 'openai-compatible'
    || (provider.type === 'custom-api' && !!provider.customApiModes?.openai && !provider.customApiModes?.anthropic)
  );
  const proxy = needsResponsesProxy
    ? await startResponsesProxy({ upstreamUrl: upstream })
    : needsOpenAIProxy
      ? await startOpenAIProxy({ upstreamUrl: upstream })
      : await startAnthropicScrubberProxy({ upstreamUrl: upstream });
```

- [ ] **Step 5.8: Run transaction tests**

```bash
npx vitest run src/launcher/transaction.test.ts
```

Expected: all tests pass.

- [ ] **Step 5.9: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (no regressions).

- [ ] **Step 5.10: Commit integration**

```bash
git add src/adapters/claude-code.ts src/adapters/claude-code.test.ts \
        src/launcher/transaction.ts src/launcher/transaction.test.ts
git commit -m "feat: add responses-compatible provider support to claude-code adapter"
```

---

## Verification

After all tasks complete:

```bash
npx vitest run
```

Expected output: all existing tests + ~50 new tests pass, zero failures.
