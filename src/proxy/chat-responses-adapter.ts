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
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
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

/** Map a Responses `incomplete_details.reason` to a Chat Completions finish reason. */
function mapFinishReason(hasToolCalls: boolean, incompleteReason: string | undefined): string {
  if (hasToolCalls) return 'tool_calls';
  if (incompleteReason === 'max_output_tokens') return 'length';
  if (incompleteReason === 'content_filter') return 'content_filter';
  return 'stop';
}

/** Extract usage from a Responses payload in Chat Completions shape. */
function convertUsage(raw: unknown): Record<string, number> {
  const usage = isRecord(raw) ? raw : {};
  const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : prompt + completion;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

/**
 * Convert a Responses API response body into a Chat Completions completion.
 *
 * `function_call` items become `tool_calls` keyed by their `call_id` (the id the
 * client must echo back as `tool_call_id`), and `message.content` stays `null`
 * when the answer carries no text. Pure function.
 */
export function convertResponsesToChatResponse(
  res: unknown,
  fallbackModel: string,
): Record<string, unknown> {
  const response = isRecord(res) ? res : {};
  const output = Array.isArray(response.output) ? response.output : [];

  const textParts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const part of parts) {
        if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
          textParts.push(part.text);
        }
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: String(item.call_id ?? item.id ?? ''),
        type: 'function',
        function: {
          name: String(item.name ?? ''),
          arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
        },
      });
    }
  }

  const text = textParts.join('');
  const message: Record<string, unknown> = { role: 'assistant', content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const incomplete = isRecord(response.incomplete_details) ? response.incomplete_details : {};
  const incompleteReason = typeof incomplete.reason === 'string' ? incomplete.reason : undefined;

  return {
    id: String(response.id ?? 'chatcmpl-bridge'),
    object: 'chat.completion',
    created:
      typeof response.created_at === 'number' ? response.created_at : Math.floor(Date.now() / 1000),
    model: String(response.model ?? fallbackModel),
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapFinishReason(toolCalls.length > 0, incompleteReason),
      },
    ],
    usage: convertUsage(response.usage),
  };
}

/**
 * Collect a Responses SSE event list into one Chat Completions completion.
 *
 * Used when a non-streaming client asked for JSON but the gateway streamed the
 * answer anyway. Text and function-call deltas are merged per `output_index`;
 * usage and model come from the final `response.completed`. Pure function.
 */
export function responsesSseToChatResponse(
  events: Array<Record<string, unknown>>,
  fallbackModel: string,
): Record<string, unknown> {
  let text = '';
  let completed: Record<string, unknown> | undefined;
  const calls = new Map<number, { id: string; callId: string; name: string; arguments: string }>();

  for (const event of events) {
    if (!isRecord(event)) continue;
    const type = String(event.type ?? '');
    const outputIndex = typeof event.output_index === 'number' ? event.output_index : 0;

    if (type === 'response.output_text.delta') {
      text += String(event.delta ?? '');
    } else if (type === 'response.output_item.added') {
      const item = isRecord(event.item) ? event.item : {};
      if (item.type === 'function_call') {
        calls.set(outputIndex, {
          id: String(item.id ?? ''),
          callId: String(item.call_id ?? item.id ?? ''),
          name: String(item.name ?? ''),
          arguments: '',
        });
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const call = calls.get(outputIndex);
      if (call) call.arguments += String(event.delta ?? '');
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      if (isRecord(event.response)) completed = event.response;
    }
  }

  const output: Array<Record<string, unknown>> = [];
  if (text)
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  for (const call of calls.values()) {
    output.push({
      type: 'function_call',
      id: call.id,
      call_id: call.callId,
      name: call.name,
      arguments: call.arguments || '{}',
    });
  }

  return convertResponsesToChatResponse(
    {
      id: completed?.id,
      model: completed?.model ?? fallbackModel,
      created_at: completed?.created_at,
      status: 'completed',
      output,
      usage: completed?.usage,
    },
    fallbackModel,
  );
}
