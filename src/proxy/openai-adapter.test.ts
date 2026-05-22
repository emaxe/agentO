import { describe, it, expect } from 'vitest';
import { convertRequest, convertResponse, createStreamState, convertStreamChunk, convertError } from './openai-adapter.js';

describe('convertRequest', () => {
  it('converts simple text messages', () => {
    const anthropic = {
      model: 'claude-3-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 1024,
    };
    const openai = convertRequest(anthropic);
    expect(openai.model).toBe('claude-3-sonnet');
    expect(openai.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(openai.max_tokens).toBe(1024);
  });

  it('lifts top-level system into messages', () => {
    const anthropic = {
      model: 'claude-3',
      system: 'Be helpful',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    expect(openai.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(openai.messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('converts Anthropic tools to OpenAI format', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    };
    const openai = convertRequest(anthropic);
    expect(openai.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('converts tool_choice variants', () => {
    expect(convertRequest({ model: 'c', messages: [], max_tokens: 1, tool_choice: { type: 'auto' } }).tool_choice).toBe('auto');
    expect(convertRequest({ model: 'c', messages: [], max_tokens: 1, tool_choice: { type: 'any' } }).tool_choice).toBe('required');
    expect(convertRequest({ model: 'c', messages: [], max_tokens: 1, tool_choice: { type: 'none' } }).tool_choice).toBe('none');
    expect(convertRequest({ model: 'c', messages: [], max_tokens: 1, tool_choice: { type: 'tool', name: 'foo' } }).tool_choice).toEqual({
      type: 'function',
      function: { name: 'foo' },
    });
  });

  it('converts assistant tool_use to tool_calls', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check' },
            { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } },
          ],
        },
      ],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    expect(openai.messages[0]).toEqual({
      role: 'assistant',
      content: 'Let me check',
      tool_calls: [
        {
          id: 'tu_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    });
  });

  it('converts user tool_result to tool message', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Sunny' }],
        },
      ],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    expect(openai.messages[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tu_1',
      content: 'Sunny',
    });
  });

  it('uses max_completion_tokens for o-series models', () => {
    const anthropic = { model: 'o1-preview', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100 };
    const openai = convertRequest(anthropic);
    expect(openai.max_completion_tokens).toBe(100);
    expect(openai.max_tokens).toBeUndefined();
  });

  it('handles assistant message with tool_use but no text block', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } },
          ],
        },
      ],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    expect(openai.messages[0]).toEqual({
      role: 'assistant',
      tool_calls: [
        {
          id: 'tu_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        },
      ],
    });
    expect(openai.messages[0]).not.toHaveProperty('content');
  });

  it('handles user message with mixed text and tool_result blocks', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Result:' },
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'Sunny' },
            { type: 'text', text: ' Thank you' },
          ],
        },
      ],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    // tool messages must immediately follow the assistant tool_calls message;
    // any user text from the same Anthropic turn comes after.
    expect(openai.messages).toEqual([
      { role: 'tool', tool_call_id: 'tu_1', content: 'Sunny' },
      { role: 'user', content: 'Result: Thank you' },
    ]);
  });

  it('stringifies non-string tool_result.content to JSON', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: { temp: 22, unit: 'C' } },
          ],
        },
      ],
      max_tokens: 100,
    };
    const openai = convertRequest(anthropic);
    expect(openai.messages[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tu_1',
      content: '{"temp":22,"unit":"C"}',
    });
  });

  it('passes through unknown tool_choice.type values', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [],
      max_tokens: 1,
      tool_choice: { type: 'unknown_mode', extra: true },
    };
    const openai = convertRequest(anthropic);
    expect(openai.tool_choice).toEqual({ type: 'unknown_mode', extra: true });
  });

  it('handles malformed tool objects with missing fields', () => {
    const anthropic = {
      model: 'claude-3',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      tools: [{ description: 'No name' }, { name: 'no_schema' }],
    };
    const openai = convertRequest(anthropic);
    expect(openai.tools).toEqual([
      { type: 'function', function: { description: 'No name' } },
      { type: 'function', function: { name: 'no_schema' } },
    ]);
  });
});

describe('convertResponse', () => {
  it('converts simple text response', () => {
    const openai = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1677652288,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 },
    };
    const anthropic = convertResponse(openai);
    expect(anthropic.id).toBe('chatcmpl-123');
    expect(anthropic.role).toBe('assistant');
    expect(anthropic.content).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(anthropic.stop_reason).toBe('end_turn');
    expect(anthropic.usage.input_tokens).toBe(9);
    expect(anthropic.usage.output_tokens).toBe(12);
  });

  it('converts response with tool_calls', () => {
    const openai = {
      id: 'chatcmpl-tool',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    const anthropic = convertResponse(openai);
    expect(anthropic.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Paris' } },
    ]);
    expect(anthropic.stop_reason).toBe('tool_use');
  });

  it('handles invalid JSON in tool_call arguments', () => {
    const openai = {
      id: 'x',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'f', arguments: '{bad}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const anthropic = convertResponse(openai);
    expect(anthropic.content[0]).toEqual({ type: 'tool_use', id: 'c1', name: 'f', input: {} });
  });

  it('ignores null content', () => {
    const openai = {
      id: 'x',
      model: 'gpt-4',
      choices: [
        { message: { role: 'assistant', content: null }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    expect(convertResponse(openai).content).toEqual([]);
  });

  it('defaults usage to zero when missing', () => {
    const openai = {
      id: 'x',
      model: 'gpt-4',
      choices: [
        { message: { role: 'assistant', content: '' }, finish_reason: 'stop' },
      ],
    };
    expect(convertResponse(openai).usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('handles empty choices array', () => {
    const openai = {
      id: 'x',
      model: 'gpt-4',
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
    expect(convertResponse(openai).content).toEqual([]);
  });

  it('throws on non-object response', () => {
    expect(() => convertResponse(null)).toThrow('Invalid OpenAI response');
    expect(() => convertResponse('string')).toThrow('Invalid OpenAI response');
  });

  it('skips malformed tool_calls without function property', () => {
    const openai = {
      id: 'x',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function' }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const anthropic = convertResponse(openai);
    expect(anthropic.content).toEqual([]);
  });
});

describe('convertStreamChunk', () => {
  it('returns message_start on first chunk', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    const chunk = { id: 'chatcmpl-1', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] };
    const events = convertStreamChunk(chunk, state);
    expect(events).toEqual([
      {
        type: 'message_start',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'gpt-4',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    ]);
  });

  it('emits full text streaming sequence', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    const e1 = convertStreamChunk({ id: 'c', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    expect(e1).toHaveLength(1);
    expect(e1[0].type).toBe('message_start');

    const e2 = convertStreamChunk({ id: 'c', choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }, state);
    expect(e2).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    ]);

    const e3 = convertStreamChunk({ id: 'c', choices: [{ delta: { content: ' world' }, finish_reason: null }] }, state);
    expect(e3).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
    ]);

    const e4 = convertStreamChunk({ id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }] }, state);
    expect(e4).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
  });

  it('emits full tool call streaming sequence', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    convertStreamChunk({ id: 'c', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);

    const e1 = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }],
        },
        finish_reason: null,
      }],
    }, state);
    expect(e1).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
    ]);

    const e2 = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
        },
        finish_reason: null,
      }],
    }, state);
    expect(e2).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    ]);

    const e3 = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    }, state);
    expect(e3).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Paris"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
  });

  it('stops text block before starting tool block', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    convertStreamChunk({ id: 'c', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    convertStreamChunk({ id: 'c', choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }, state);
    const events = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }],
        },
        finish_reason: null,
      }],
    }, state);
    expect(events[0].type).toBe('content_block_stop');
    expect(events[1].type).toBe('content_block_start');
  });

  it('handles multiple tool calls in separate chunks', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    convertStreamChunk({ id: 'c', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    const e1 = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'foo', arguments: '' } }],
        },
        finish_reason: null,
      }],
    }, state);
    expect(e1[0].type).toBe('content_block_start');
    const e2 = convertStreamChunk({
      id: 'c',
      choices: [{
        delta: {
          tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'bar', arguments: '' } }],
        },
        finish_reason: null,
      }],
    }, state);
    expect(e2[0].type).toBe('content_block_stop');
    expect(e2[1].type).toBe('content_block_start');
  });

  it('returns empty events for null chunk', () => {
    expect(convertStreamChunk(null, createStreamState('id', 'm'))).toEqual([]);
  });

  it('returns empty events for missing choices', () => {
    expect(convertStreamChunk({}, createStreamState('id', 'm'))).toEqual([]);
  });

  it('returns empty events for empty choices', () => {
    expect(convertStreamChunk({ choices: [] }, createStreamState('id', 'm'))).toEqual([]);
  });

  it('captures usage from trailing chunk with empty choices (post-message_stop)', () => {
    const state = createStreamState('msg-1', 'gpt-4');
    // Simulate a complete streaming sequence first
    convertStreamChunk({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    convertStreamChunk({ choices: [{ delta: { content: 'hi' }, finish_reason: null }] }, state);
    convertStreamChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }, state);
    // Trailing usage chunk that arrives after message_stop
    const events = convertStreamChunk({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } }, state);
    expect(events).toEqual([]);
    expect(state.inputTokens).toBe(20);
    expect(state.outputTokens).toBe(8);
  });

  it('uses real token counts from usage in finish chunk', () => {
    const state = createStreamState('msg-2', 'gpt-4');
    convertStreamChunk({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    convertStreamChunk({ choices: [{ delta: { content: 'a' }, finish_reason: null }] }, state);
    const events = convertStreamChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 15, completion_tokens: 42 },
    }, state);
    const delta = events.find((e) => e.type === 'message_delta') as Record<string, unknown> | undefined;
    expect(delta).toBeDefined();
    expect((delta!.usage as Record<string, unknown>).output_tokens).toBe(42);
    expect(state.inputTokens).toBe(15);
  });

  it('skips non-record tool_calls entries', () => {
    const state = createStreamState('msg-123', 'gpt-4');
    convertStreamChunk({ id: 'c', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }, state);
    const events = convertStreamChunk({
      id: 'c',
      choices: [{ delta: { tool_calls: [null, { index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: '' } }] }, finish_reason: null }],
    }, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('content_block_start');
  });
});

describe('convertError', () => {
  it('maps OpenAI error format to Anthropic error format', () => {
    const openai = { error: { message: 'Bad request', type: 'invalid_request_error', code: '400' } };
    const anthropic = convertError(openai);
    expect(anthropic).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Bad request' },
    });
  });

  it('passes through string errors', () => {
    expect(convertError('something broke')).toEqual({
      type: 'error',
      error: { type: 'api_error', message: 'something broke' },
    });
  });

  it('handles null error', () => {
    expect(convertError(null)).toEqual({ type: 'error', error: { type: 'api_error', message: 'null' } });
  });

  it('handles number error', () => {
    expect(convertError(500)).toEqual({ type: 'error', error: { type: 'api_error', message: '500' } });
  });

  it('handles empty object error', () => {
    expect(convertError({})).toEqual({ type: 'error', error: { type: 'api_error', message: 'Unknown error' } });
  });

  it('handles nested error missing type', () => {
    expect(convertError({ error: { message: 'Missing type' } })).toEqual({
      type: 'error', error: { type: 'api_error', message: 'Missing type' },
    });
  });

  it('handles nested error missing message', () => {
    expect(convertError({ error: { type: 'rate_limit' } })).toEqual({
      type: 'error', error: { type: 'rate_limit', message: 'Unknown error' },
    });
  });

  it('handles top-level message field', () => {
    expect(convertError({ message: 'Plain message' })).toEqual({
      type: 'error', error: { type: 'api_error', message: 'Plain message' },
    });
  });
});
