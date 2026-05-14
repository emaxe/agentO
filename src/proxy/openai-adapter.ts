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

  // Detects OpenAI o-series models (o1, o3, etc.) by their "o" prefix + digit naming.
  if (/^o\d/.test(req.model)) {
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
          stringifiedContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
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
      toolResults.unshift({ role: 'user', content: textParts.join('') });
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
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.name } };
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
  const r = res as Record<string, unknown>;
  const choice = ((r.choices as Array<Record<string, unknown>>)?.[0]) ?? {};
  const message = (choice.message as Record<string, unknown>) ?? {};
  const finishReason = String(choice.finish_reason ?? 'stop');

  const content: Array<Record<string, unknown>> = [];

  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }

  const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      let input: unknown = {};
      try {
        input = JSON.parse(String(tc.function?.arguments ?? '{}'));
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: String(tc.id ?? ''),
        name: String(tc.function?.name ?? ''),
        input,
      });
    }
  }

  const usage = (r.usage as Record<string, number>) ?? {};

  return {
    id: String(r.id ?? ''),
    type: 'message',
    role: 'assistant',
    content,
    model: String(r.model ?? ''),
    stop_reason: mapFinishReason(finishReason),
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
  };
}

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
