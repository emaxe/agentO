# Responses-Compatible Proxy для Claude Code

**Дата:** 2026-05-22  
**Статус:** Approved

## Контекст

Claude Code отправляет запросы в Anthropic API формате (`POST /v1/messages`). Часть провайдеров
(Azure OpenAI, OpenAI native, совместимые реализации) использует OpenAI Responses API формат
(`POST /v1/responses`). Без прокси эти провайдеры недоступны через claude-code адаптер.

Цель: добавить `responses-compatible` тип провайдера в claude-code адаптер agento через
standalone прокси-сервер, аналогичный существующему `openai-proxy`.

## Scope

- Полная трансляция текстовых сообщений (user/assistant)
- Полная трансляция tool use / function calling (запрос и ответ, включая стриминг)
- Трансляция extended thinking (`thinking.budget_tokens` → `reasoning.effort`)
- Streaming и non-streaming режимы
- Таймаут 120 секунд (опциональный параметр для тестов)

Не входит в scope:
- Поддержка `previous_response_id` (всегда stateless, полная история)
- Трансляция image источников типа `url` (только base64)
- Computer Use инструменты

---

## Новые файлы

### `src/proxy/responses-adapter.ts`

Чистые функции конвертации без HTTP. Экспортирует:

```ts
export interface StreamState {
  id: string;
  model: string;
  itemIndexMap: Map<number, number>; // output_item index → content_block index
  blockCount: number;
  inputTokens: number;
  outputTokens: number;
}

export function createStreamState(id: string, model: string): StreamState;
export function convertRequest(body: Record<string, unknown>): Record<string, unknown>;
export function convertResponse(body: Record<string, unknown>): Record<string, unknown>;
export function convertError(body: unknown): Record<string, unknown>;
export function convertStreamChunk(event: { type: string; [k: string]: unknown }, state: StreamState): Array<Record<string, unknown>>;
```

### `src/proxy/responses-proxy.ts`

HTTP прокси. Экспортирует `startResponsesProxy(options)` → `ProxyServer`.

```ts
export interface ResponsesProxyOptions {
  upstreamUrl: string;
  port?: number;
  timeoutMs?: number; // default 120_000
}
```

### `src/proxy/responses-adapter.test.ts`

Unit-тесты для каждой функции конвертации.

### `src/proxy/responses-proxy.test.ts`

Интеграционные тесты с echo-сервером.

---

## Конвертация запроса (Anthropic → Responses API)

### Messages → Input

Каждое Anthropic `message` превращается в один или несколько Responses API `input` items:

| Anthropic | Responses API |
|-----------|---------------|
| `{ role:"user", content:"text" }` | `{ type:"message", role:"user", content:[{ type:"input_text", text }] }` |
| `{ type:"text", text }` в content | `{ type:"input_text", text }` внутри message-item |
| `{ type:"tool_result", tool_use_id, content }` | `{ type:"function_call_output", call_id, output }` — top-level item |
| `{ role:"assistant", content:[{ type:"text" }] }` | `{ type:"message", role:"assistant", content:[{ type:"output_text", text }] }` |
| `{ type:"tool_use", id, name, input }` в assistant | `{ type:"function_call", call_id:id, name, arguments:JSON.stringify(input) }` — top-level item |

Смешанное assistant-сообщение (text + tool_use) разбивается на несколько top-level items.

### Параметры

| Anthropic | Responses API |
|-----------|---------------|
| `system` | `instructions` (top-level string) |
| `max_tokens` | `max_output_tokens` |
| `temperature` | `temperature` |
| `stream` | `stream` |
| `tools[].input_schema` | `tools[].parameters` (+ `type:"function"`) |
| `thinking.budget_tokens < 2000` | `reasoning: { effort: "low" }` |
| `thinking.budget_tokens < 10000` | `reasoning: { effort: "medium" }` |
| `thinking.budget_tokens ≥ 10000` | `reasoning: { effort: "high" }` |

`model` пробрасывается без изменений.

### Заголовки

Использует существующий `buildProxyHeaders` из `proxy-utils.ts`:
- Стрипает `anthropic-version`, `anthropic-beta`
- Конвертирует `x-api-key` → `Authorization: Bearer ...`

---

## Конвертация ответа (Responses API → Anthropic)

### Non-streaming

```
Responses API                          Anthropic
─────────────────────────────────────────────────────────────────────
output[].type === "message"         →  content[].type = "text"
output[].type === "function_call"   →  content[].type = "tool_use",
                                       id = call_id, input = JSON.parse(arguments)
usage.input_tokens                  →  usage.input_tokens
usage.output_tokens                 →  usage.output_tokens
Нет function_call в output          →  stop_reason = "end_turn"
Есть function_call в output         →  stop_reason = "tool_use"
```

### Streaming — маппинг SSE событий

| Responses API event | → Anthropic events |
|--------------------|--------------------|
| `response.created` | `message_start` (stub message) |
| `response.output_item.added` (type=message) | `content_block_start` (type=text, index N) |
| `response.output_text.delta` | `content_block_delta` (text_delta) |
| `response.output_item.added` (type=function_call) | `content_block_start` (type=tool_use, id=item.call_id, name=item.name, index N) |
| `response.function_call_arguments.delta` | `content_block_delta` (input_json_delta) |
| `response.output_item.done` | `content_block_stop` (index N) |
| `response.reasoning_summary_text.delta` | `content_block_delta` (thinking_delta) |
| `response.completed` | `message_delta` (stop_reason + usage) + `message_stop` |

`StreamState.itemIndexMap` хранит маппинг `output_item.index → content_block_index` для корректной привязки delta-событий к блокам.

---

## Изменения в существующих файлах

### `src/adapters/claude-code.ts`

```ts
// supportedProviderTypes — добавить:
'responses-compatible'

// buildConfig — новая ветка для custom-api с responses:
if (customApiModes.responses) {
  apiUrl = resolveCustomApiUrl(provider, 'responses');
}
```

### `src/launcher/transaction.ts`

```ts
// maybeStartProxy — новая ветка:
if (providerType === 'responses-compatible' || isCustomApiResponses) {
  const { startResponsesProxy } = await import('../proxy/responses-proxy.js');
  const proxy = await startResponsesProxy({ upstreamUrl: upstream });
  apiUrl = proxy.url;
  proxies.push(proxy);
}
```

---

## Тестирование

### `responses-adapter.test.ts` (unit)

- `convertRequest`: text message, tool_result в user, tool_use в assistant, mixed assistant, thinking→reasoning маппинг, tools schema конвертация
- `convertResponse`: text output, function_call output, stop_reason logic, usage mapping
- `convertStreamChunk`: каждый тип Responses API event → ожидаемые Anthropic events, multi-block, reasoning delta

### `responses-proxy.test.ts` (integration)

- Запускается на случайном порту, возвращает url
- Non-streaming текстовый запрос end-to-end
- Streaming текстовый запрос, SSE события
- Tool use round-trip (function_call в стриминге)
- Forwarding GET-запросов
- Upstream timeout → 502
- Upstream недоступен → 502
- Заголовки: `anthropic-version` стрипается, `x-api-key` → `Authorization`
- Client disconnect в середине стрима

---

## Объём изменений

- Новые файлы: ~4 файла, ~700-900 строк
- Изменения в существующих файлах: ~50 строк (claude-code.ts, transaction.ts)
- Не затрагивает openai-proxy, anthropic-scrubber, openai-adapter
