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
