import { describe, it, expect } from 'vitest';
import {
  convertChatRequestToResponses,
  convertResponsesToChatResponse,
  responsesSseToChatResponse,
  createChatStreamState,
  convertResponsesEventToChatChunks,
  chatCompletionToStreamChunks,
} from './chat-responses-adapter.js';

type ChatChoice = {
  message: {
    role: string;
    content: unknown;
    tool_calls?: Array<Record<string, unknown>>;
  };
  finish_reason: string;
};

/** First choice of a converted completion, typed for assertions. */
function firstChoice(out: Record<string, unknown>): ChatChoice {
  return (out.choices as ChatChoice[])[0];
}

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
    expect(firstChoice(out).message).toEqual({ role: 'assistant', content: 'hello' });
    expect(firstChoice(out).finish_reason).toBe('stop');
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
    const choice = firstChoice(out);
    expect(choice.message.content).toBeNull();
    expect(choice.message.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{"x":1}' } },
    ]);
    expect(choice.finish_reason).toBe('tool_calls');
  });

  it('maps an incomplete max_output_tokens answer to length', () => {
    const out = convertResponsesToChatResponse(
      {
        id: 'resp_3',
        model: 'gpt-6.1-sol',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      },
      'gpt-6.1-sol',
    );
    expect(firstChoice(out).finish_reason).toBe('length');
  });

  it('collects an SSE stream into one completion', () => {
    const out = responsesSseToChatResponse(
      [
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'ping' },
        },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"x":1}' },
        {
          type: 'response.completed',
          response: {
            id: 'resp_4',
            model: 'gpt-6.1-sol',
            usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
          },
        },
      ],
      'gpt-6.1-sol',
    );
    const choice = firstChoice(out);
    expect(choice.message.tool_calls?.[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'ping', arguments: '{"x":1}' },
    });
    expect(choice.finish_reason).toBe('tool_calls');
  });
});

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
        response: {
          model: 'gpt-6.1-sol',
          usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
        },
      },
    ]);
    expect(chunks[0]).toMatchObject({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant' } }],
    });
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
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'ping', arguments: '' },
              },
            ],
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
    const chunks = collect([{ type: 'response.failed', response: { error: { message: 'boom' } } }]);
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
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } },
            ],
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
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'ping', arguments: '{}' },
              },
            ],
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
