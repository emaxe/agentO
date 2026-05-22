/** Type guard for plain objects. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Converts an Anthropic /v1/messages request body into a Responses API request body. */
export function convertRequest(req: Record<string, unknown>): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = [];
  const messages = Array.isArray(req.messages) ? req.messages : [];

  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const role = String(msg.role ?? '');
    const content = msg.content;

    if (role === 'user') {
      if (typeof content === 'string') {
        input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] });
      } else if (Array.isArray(content)) {
        const textParts: Array<Record<string, unknown>> = [];
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text') {
            textParts.push({ type: 'input_text', text: String(block.text ?? '') });
          } else if (block.type === 'tool_result') {
            let output: string;
            try {
              output = typeof block.content === 'string'
                ? block.content
                : (block.content === undefined ? '' : JSON.stringify(block.content));
            } catch {
              output = '';
            }
            if (textParts.length > 0) {
              input.push({ type: 'message', role: 'user', content: [...textParts] });
              textParts.length = 0;
            }
            input.push({ type: 'function_call_output', call_id: String(block.tool_use_id ?? ''), output });
          }
        }
        if (textParts.length > 0) {
          input.push({ type: 'message', role: 'user', content: textParts });
        }
      }
    } else if (role === 'assistant') {
      if (typeof content === 'string') {
        input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] });
      } else if (Array.isArray(content)) {
        const textParts: Array<Record<string, unknown>> = [];
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text') {
            textParts.push({ type: 'output_text', text: String(block.text ?? '') });
          } else if (block.type === 'tool_use') {
            if (textParts.length > 0) {
              input.push({ type: 'message', role: 'assistant', content: [...textParts] });
              textParts.length = 0;
            }
            let args: string;
            try {
              args = JSON.stringify(block.input ?? {});
            } catch {
              args = '{}';
            }
            input.push({
              type: 'function_call',
              call_id: String(block.id ?? ''),
              name: String(block.name ?? ''),
              arguments: args,
            });
          }
        }
        if (textParts.length > 0) {
          input.push({ type: 'message', role: 'assistant', content: textParts });
        }
      }
    }
  }

  const result: Record<string, unknown> = {
    model: String(req.model ?? ''),
    input,
    stream: req.stream,
  };

  if (typeof req.max_tokens === 'number') result.max_output_tokens = req.max_tokens;
  if (typeof req.temperature === 'number') result.temperature = req.temperature;
  if (typeof req.system === 'string') result.instructions = req.system;
  if (Array.isArray(req.tools)) result.tools = (req.tools as Array<Record<string, unknown>>).map(convertTool);

  if (isRecord(req.thinking) && req.thinking.type === 'enabled') {
    const budget = typeof req.thinking.budget_tokens === 'number' ? req.thinking.budget_tokens : 0;
    result.reasoning = { effort: budget < 2000 ? 'low' : budget < 10000 ? 'medium' : 'high' };
  }

  return result;
}

function convertTool(tool: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  };
}

/** Converts a Responses API response body into an Anthropic /v1/messages response body. */
export function convertResponse(res: unknown): Record<string, unknown> {
  throw new Error('not implemented');
}

/** Converts an error into Anthropic error format. */
export function convertError(err: unknown): Record<string, unknown> {
  throw new Error('not implemented');
}

/** Mutable state for streaming a Responses API SSE stream into Anthropic SSE events. */
export interface StreamState {
  id: string;
  model: string;
  initialized: boolean;
  /** Maps output_index (or '__reasoning__') → Anthropic content_block index. */
  itemIndexMap: Map<number | string, number>;
  nextBlockIndex: number;
  inputTokens: number;
  outputTokens: number;
}

/** Create a fresh StreamState for a new streaming session. */
export function createStreamState(id: string, model: string): StreamState {
  throw new Error('not implemented');
}

/** Convert one Responses API SSE event into zero or more Anthropic SSE event objects. */
export function convertStreamChunk(event: Record<string, unknown>, state: StreamState): Array<Record<string, unknown>> {
  throw new Error('not implemented');
}
