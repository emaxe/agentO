/** Anthropic API request shape (subset used for conversion). */
export interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
}

/** OpenAI Chat Completions API request shape (subset used for conversion). */
export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: string;
    content?: unknown;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<Record<string, unknown>>;
  }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
}

/** Convert an Anthropic-style request into an OpenAI-compatible request. */
export function convertRequest(req: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIRequest['messages'] = [];

  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  for (const msg of req.messages) {
    const converted = convertMessage(msg);
    if (Array.isArray(converted)) {
      messages.push(...converted);
    } else {
      messages.push(converted);
    }
  }

  const result: OpenAIRequest = {
    model: req.model,
    messages,
    temperature: req.temperature,
    top_p: req.top_p,
    stop: req.stop_sequences,
    stream: req.stream,
    tools: req.tools ? req.tools.map(convertTool) : undefined,
    tool_choice: req.tool_choice ? convertToolChoice(req.tool_choice) : undefined,
  };

  // o-series (o1, o3, o4) and gpt-5.x require max_completion_tokens; older models use max_tokens.
  if (/^o\d/.test(req.model) || /^gpt-5/.test(req.model)) {
    result.max_completion_tokens = req.max_tokens;
  } else {
    result.max_tokens = req.max_tokens;
  }

  return result;
}

/** Convert a single Anthropic message into one or more OpenAI messages. */
function convertMessage(msg: AnthropicRequest['messages'][number]): OpenAIRequest['messages'][number] | OpenAIRequest['messages'] {
  const role = msg.role;
  const content = msg.content;

  if (role === 'assistant' && Array.isArray(content)) {
    const textParts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      if (block.type === 'text') {
        textParts.push(String(block.text ?? ''));
      } else if (block.type === 'tool_use') {
        let args: string;
        try {
          args = JSON.stringify(block.input ?? {});
        } catch {
          args = '{}';
        }
        toolCalls.push({
          id: String(block.id ?? ''),
          type: 'function',
          function: {
            name: String(block.name ?? ''),
            arguments: args,
          },
        });
      }
    }
    const result: OpenAIRequest['messages'][number] = { role: 'assistant' };
    const text = textParts.join('');
    if (text) result.content = text;
    if (toolCalls.length) result.tool_calls = toolCalls;
    return result;
  }

  if (role === 'user' && Array.isArray(content)) {
    const toolResults: OpenAIRequest['messages'] = [];
    const textParts: string[] = [];
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      if (block.type === 'tool_result') {
        let stringifiedContent: string;
        try {
          stringifiedContent = typeof block.content === 'string' ? block.content : (block.content === undefined ? '' : JSON.stringify(block.content));
        } catch {
          stringifiedContent = '';
        }
        toolResults.push({
          role: 'tool',
          tool_call_id: String(block.tool_use_id ?? ''),
          content: stringifiedContent,
        });
      } else if (block.type === 'text') {
        textParts.push(String(block.text ?? ''));
      }
    }
    if (textParts.length > 0) {
      // Text parts must come AFTER tool messages: OpenAI requires all tool role messages
      // to immediately follow the assistant message that issued the tool_calls.
      toolResults.push({ role: 'user', content: textParts.join('') });
    }
    return toolResults;
  }

  return { role, content };
}

/** Convert an Anthropic tool definition into an OpenAI tool definition. */
function convertTool(tool: Record<string, unknown>): Record<string, unknown> {
  const fn: Record<string, unknown> = {};
  if ('name' in tool) fn.name = tool.name;
  if ('description' in tool) fn.description = tool.description;
  if ('input_schema' in tool) fn.parameters = tool.input_schema;
  return { type: 'function', function: fn };
}

/** Convert an Anthropic tool_choice value into an OpenAI tool_choice value. */
function convertToolChoice(toolChoice: Record<string, unknown>): unknown {
  if (!('type' in toolChoice)) {
    return toolChoice;
  }
  // Anthropic tool_choice.type values mapped to OpenAI equivalents.
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: String(toolChoice.name ?? '') } };
    default:
      return toolChoice;
  }
}

/** Anthropic API response shape (subset used for conversion). */
export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<Record<string, unknown>>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: { input_tokens: number; output_tokens: number };
  [key: string]: unknown;
}

/** Convert an OpenAI chat completion response into an Anthropic-compatible response. */
export function convertResponse(res: unknown): AnthropicResponse {
  if (typeof res !== 'object' || res === null) {
    throw new Error('Invalid OpenAI response');
  }
  const r = res;
  const choices = isRecord(r) ? r.choices : undefined;
  const choice = Array.isArray(choices) && choices.length > 0 && isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const finishReason = String(choice.finish_reason ?? 'stop');

  const content: Array<Record<string, unknown>> = [];

  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : undefined;
  if (toolCalls) {
    for (const tc of toolCalls) {
      if (!isRecord(tc)) continue;
      if (!isRecord(tc.function)) continue;
      const fn = tc.function;
      let input: unknown = {};
      try {
        input = JSON.parse(String(fn.arguments ?? '{}'));
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: String(tc.id ?? ''),
        name: String(fn.name ?? ''),
        input,
      });
    }
  }

  const rawUsage = isRecord(r) && isRecord(r.usage) ? r.usage : undefined;
  const inputTokens = typeof rawUsage?.prompt_tokens === 'number' ? rawUsage.prompt_tokens : 0;
  const outputTokens = typeof rawUsage?.completion_tokens === 'number' ? rawUsage.completion_tokens : 0;

  return {
    id: String(isRecord(r) ? r.id ?? '' : ''),
    type: 'message',
    role: 'assistant',
    content,
    model: String(isRecord(r) ? r.model ?? '' : ''),
    stop_reason: mapFinishReason(finishReason),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

/** Map an OpenAI finish_reason string to the Anthropic stop_reason equivalent. */
function mapFinishReason(fr: string): AnthropicResponse['stop_reason'] {
  switch (fr) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

/** Type guard for plain objects. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Convert an OpenAI-style error into an Anthropic-style error record. */
export function convertError(err: unknown): Record<string, unknown> {
  if (typeof err === 'string') {
    return { type: 'error', error: { type: 'api_error', message: err } };
  }
  if (!isRecord(err)) {
    return { type: 'error', error: { type: 'api_error', message: String(err) } };
  }
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

/** Mutable state accumulated while streaming an OpenAI chat completion into Anthropic SSE events. */
export interface StreamState {
  id: string;
  model: string;
  initialized: boolean;
  currentBlockType: 'text' | 'tool_use' | null;
  currentBlockIndex: number | null;
  toolCalls: Map<number, { id: string; name: string; arguments: string; blockIndex: number | null }>;
  nextBlockIndex: number;
  /** Output token count: real value when provider includes usage in SSE, otherwise chunk count approximation. */
  outputTokens: number;
  /** Input token count from provider usage data; 0 until received. */
  inputTokens: number;
}

/** Create a fresh {@link StreamState} for a single streaming session. */
export function createStreamState(id: string, model: string): StreamState {
  return {
    id,
    model,
    initialized: false,
    currentBlockType: null,
    currentBlockIndex: null,
    toolCalls: new Map(),
    nextBlockIndex: 0,
    outputTokens: 0,
    inputTokens: 0,
  };
}

/**
 * Convert a single OpenAI streaming chunk into zero or more Anthropic SSE events.
 *
 * Mutates `state` to keep track of block indexes, initialization, and output tokens.
 */
export function convertStreamChunk(chunk: unknown, state: StreamState): Array<Record<string, unknown>> {
  if (!isRecord(chunk)) return [];
  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    // Capture usage data that some providers send in a trailing chunk after message_stop.
    const lateUsage = isRecord(chunk.usage) ? chunk.usage : undefined;
    if (lateUsage) {
      if (typeof lateUsage.prompt_tokens === 'number') state.inputTokens = lateUsage.prompt_tokens;
      if (typeof lateUsage.completion_tokens === 'number') state.outputTokens = lateUsage.completion_tokens;
    }
    return [];
  }
  const choice = isRecord(choices[0]) ? choices[0] : {};
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;

  const events: Array<Record<string, unknown>> = [];

  if (!state.initialized) {
    state.initialized = true;
    events.push({
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

  const content = delta.content;
  if (typeof content === 'string' && content !== '') {
    if (state.currentBlockType !== 'text') {
      if (state.currentBlockType !== null && state.currentBlockIndex !== null) {
        events.push({ type: 'content_block_stop', index: state.currentBlockIndex });
      }
      const idx = state.nextBlockIndex++;
      state.currentBlockType = 'text';
      state.currentBlockIndex = idx;
      events.push({
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'text', text: '' },
      });
    }
    const idx = state.currentBlockIndex;
    if (idx !== null) {
      events.push({
        type: 'content_block_delta',
        index: idx,
        delta: { type: 'text_delta', text: content },
      });
    }
    state.outputTokens += 1;
  }

  const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : undefined;
  if (toolCalls) {
    for (const tc of toolCalls) {
      if (!isRecord(tc)) continue;
      const idx = typeof tc.index === 'number' ? tc.index : 0;
      let call = state.toolCalls.get(idx);
      if (!call) {
        const fn = isRecord(tc.function) ? tc.function : {};
        call = {
          id: typeof tc.id === 'string' ? tc.id : '',
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: '',
          blockIndex: null,
        };
        state.toolCalls.set(idx, call);
      }
      if (call.blockIndex === null) {
        if (state.currentBlockType !== null && state.currentBlockIndex !== null) {
          events.push({ type: 'content_block_stop', index: state.currentBlockIndex });
        }
        const bIdx = state.nextBlockIndex++;
        state.currentBlockType = 'tool_use';
        state.currentBlockIndex = bIdx;
        call.blockIndex = bIdx;
        events.push({
          type: 'content_block_start',
          index: bIdx,
          content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
        });
      }
      const fn = isRecord(tc.function) ? tc.function : {};
      const argDelta = typeof fn.arguments === 'string' ? fn.arguments : undefined;
      if (argDelta !== undefined && argDelta !== '' && call.blockIndex !== null) {
        call.arguments += argDelta;
        events.push({
          type: 'content_block_delta',
          index: call.blockIndex,
          delta: { type: 'input_json_delta', partial_json: argDelta },
        });
        state.outputTokens += 1;
      }
    }
  }

  if (finishReason !== null) {
    // Some providers (Groq, OpenRouter) include usage in the finish chunk itself.
    const finishUsage = isRecord(chunk.usage) ? chunk.usage : undefined;
    if (finishUsage) {
      if (typeof finishUsage.prompt_tokens === 'number') state.inputTokens = finishUsage.prompt_tokens;
      if (typeof finishUsage.completion_tokens === 'number') state.outputTokens = finishUsage.completion_tokens;
    }

    if (state.currentBlockType !== null && state.currentBlockIndex !== null) {
      events.push({ type: 'content_block_stop', index: state.currentBlockIndex });
      state.currentBlockType = null;
      state.currentBlockIndex = null;
    }
    const stopReason = mapFinishReason(finishReason);
    events.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: state.outputTokens },
    });
    events.push({ type: 'message_stop' });
  }

  return events;
}
