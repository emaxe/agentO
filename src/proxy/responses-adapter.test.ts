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
