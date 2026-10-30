import type { OpenAIRequest } from './openai-adapter.js';

/** Type guard for plain objects. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Reasoning effort values the Responses API accepts. */
const SUPPORTED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Extra options for the chat → Responses conversion. */
export interface ChatResponsesOptions {
  /** The effort the client sent before any proxy rewrite, e.g. `none` injected for gpt-6. */
  originalReasoningEffort?: string;
}

/** Chat Completions request shape with unknown extra fields allowed (they are dropped). */
type ChatRequest = OpenAIRequest & { [key: string]: unknown };

/** Join the text of a message content value, whether it is a string or parts. */
function collectText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join('');
}

/** Stringify a tool result payload, which the Responses API expects as a string. */
function stringifyOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/** Convert Chat Completions user content into Responses input content parts. */
function convertUserContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }];
  if (!Array.isArray(content)) return [];
  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'input_text', text: part.text });
    } else if (part.type === 'image_url') {
      const imageUrl = isRecord(part.image_url) ? part.image_url.url : part.image_url;
      if (typeof imageUrl === 'string') parts.push({ type: 'input_image', image_url: imageUrl });
    }
  }
  return parts;
}

/** Convert one Chat Completions tool definition into a Responses tool definition. */
function convertTool(tool: unknown): Record<string, unknown> {
  if (!isRecord(tool)) return {};
  const fn = isRecord(tool.function) ? tool.function : {};
  const converted: Record<string, unknown> = { type: 'function', name: fn.name };
  if (fn.description !== undefined) converted.description = fn.description;
  if (fn.parameters !== undefined) converted.parameters = fn.parameters;
  return converted;
}

/** Convert one Chat Completions tool_choice into a Responses tool_choice. */
function convertToolChoice(choice: unknown): unknown {
  if (!isRecord(choice)) return choice;
  if (choice.type === 'function' && isRecord(choice.function)) {
    return { type: 'function', name: choice.function.name };
  }
  return choice;
}

/**
 * Convert a Chat Completions request body into a Responses API request body.
 *
 * Only the fields the Responses API understands are emitted; sampling knobs
 * (`temperature`, `top_p`, `stop`, `seed`, `presence_penalty`, …) that
 * reasoning-only models reject are dropped, as is any unknown client field.
 * The client's original `reasoning_effort` wins over the proxy's injected
 * `none`, which reasoning-only models reject; unsupported values are omitted.
 * Pure function: no network, no filesystem access.
 */
export function convertChatRequestToResponses(
  req: ChatRequest,
  options: ChatResponsesOptions = {},
): Record<string, unknown> {
  const instructions: string[] = [];
  const input: Array<Record<string, unknown>> = [];

  for (const message of req.messages ?? []) {
    if (!isRecord(message)) continue;
    const role = String(message.role ?? '');

    if (role === 'system' || role === 'developer') {
      const text = collectText(message.content);
      if (text) instructions.push(text);
      continue;
    }

    if (role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(message.tool_call_id ?? ''),
        output: stringifyOutput(message.content),
      });
      continue;
    }

    if (role === 'user') {
      const content = convertUserContent(message.content);
      if (content.length > 0) input.push({ type: 'message', role: 'user', content });
      continue;
    }

    if (role === 'assistant') {
      const text = collectText(message.content);
      if (text) {
        input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
      }
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const call of toolCalls) {
        if (!isRecord(call)) continue;
        const fn = isRecord(call.function) ? call.function : {};
        input.push({
          type: 'function_call',
          call_id: String(call.id ?? ''),
          name: String(fn.name ?? ''),
          arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
        });
      }
    }
  }

  const result: Record<string, unknown> = {
    model: String(req.model ?? ''),
    input,
  };

  if (instructions.length > 0) result.instructions = instructions.join('\n\n');
  if (Array.isArray(req.tools)) result.tools = req.tools.map(convertTool);
  if (req.tool_choice !== undefined) result.tool_choice = convertToolChoice(req.tool_choice);

  const maxOutputTokens = req.max_completion_tokens ?? req.max_tokens;
  if (typeof maxOutputTokens === 'number') result.max_output_tokens = maxOutputTokens;

  const effort = options.originalReasoningEffort;
  if (effort !== undefined && SUPPORTED_EFFORTS.has(effort)) result.reasoning = { effort };

  result.stream = req.stream === true;
  result.store = false;

  return result;
}
