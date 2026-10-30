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
      {
        type: 'function',
        name: 'ping',
        description: 'ping',
        parameters: { type: 'object', properties: {} },
      },
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
          tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'ping', arguments: '{"x":1}' } },
          ],
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
    for (const key of [
      'temperature',
      'top_p',
      'stop',
      'seed',
      'presence_penalty',
      'frequency_penalty',
      'logit_bias',
    ]) {
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
