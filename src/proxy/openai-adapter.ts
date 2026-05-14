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
