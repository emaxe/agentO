import { describe, it, expect } from 'vitest';
import { convertRequest, convertResponse } from './openai-adapter.js';

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
    expect(openai.messages).toEqual([
      { role: 'user', content: 'Result: Thank you' },
      { role: 'tool', tool_call_id: 'tu_1', content: 'Sunny' },
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
});
