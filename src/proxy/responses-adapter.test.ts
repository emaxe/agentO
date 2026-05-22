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
