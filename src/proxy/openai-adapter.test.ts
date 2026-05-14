import { describe, it, expect } from 'vitest';
import { convertRequest } from './openai-adapter.js';

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
});
