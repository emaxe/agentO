# proxy-test

Тестирование прокси-серверов agento против реального OpenAI-совместимого или Anthropic-совместимого API.

## Когда использовать

- Валидация нового провайдера/URL после настройки
- Проверка стабильности после изменений в `src/proxy/`
- Диагностика проблем с конкретной моделью

## Что тестируется

Три уровня проверки:

| Уровень | Что делает |
|---------|-----------|
| **direct** | Прямой запрос к API (без прокси), как baseline |
| **openai-proxy** | Клиент→Anthropic-формат → прокси → OpenAI-формат → сервер |
| **scrubber** | Клиент→Anthropic-формат → scrubber (strip denylist) → Anthropic-формат → сервер |

Для каждого уровня: streaming (`stream: true`) + non-streaming (`stream: false`).

## Параметры запуска

Перед запуском нужно знать:
- `API_KEY` — Bearer-токен провайдера
- `API_BASE` — базовый URL (`http://host:port`)
- `UPSTREAM_PATH` — путь к API (обычно `/api/v1`)
- Модели для теста — полные ID как в `/v1/models`
- Тип API провайдера: `openai` (путь `/chat/completions`) или `anthropic` (путь `/messages`)

## Шаблон тест-скрипта

```js
// Запуск: node /tmp/proxy-test.mjs
// Требует предварительной сборки: npm run build
import http from 'node:http';

const API_KEY   = 'sk-...';
const API_BASE  = 'http://host:port';
const UPSTREAM  = `${API_BASE}/api/v1`;  // или /v1

const MODELS = [
  { id: 'model-id-here', label: 'short-label', maxTokens: 100, reasoning: false },
  // reasoning: true — модель тратит токены на thinking; нужен maxTokens ≥ 300
];
const PROMPT = 'Столица России? Одно слово.';

// helpers
function color(c, t) { return `\x1b[${c}m${t}\x1b[0m`; }
const G = t => color('32', t), R = t => color('31', t);
const D = t => color('2', t),  B = t => color('1', t), Y = t => color('33', t);

function post(url, headers, body) {
  return new Promise((res, rej) => {
    const b = JSON.stringify(body);
    const u = new URL(url);
    const r = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, resp => {
      const c = []; resp.on('data', d => c.push(d));
      resp.on('end', () => res({ status: resp.statusCode, body: Buffer.concat(c).toString() }));
    });
    r.on('error', rej); r.write(b); r.end();
  });
}

// Разбор SSE-ответа в Anthropic-формате
function parseAnthropicSSE(raw) {
  if (raw.trimStart().startsWith('{')) {              // non-streaming JSON
    try {
      const j = JSON.parse(raw);
      return { text: j.content?.filter(b=>b.type==='text').map(b=>b.text).join('').trim() ?? '', evTypes: ['(json)'], usage: j.usage };
    } catch {}
  }
  let text = '', thinkText = '', usage = null;
  const evTypes = [];
  for (const block of raw.split('\n\n')) {
    let evType = null, data = null;
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (t.startsWith('event: ')) evType = t.slice(7);
      if (t.startsWith('data: ') && t !== 'data: [DONE]') { try { data = JSON.parse(t.slice(6)); } catch {} }
    }
    if (evType && !evTypes.includes(evType)) evTypes.push(evType);
    if (evType === 'content_block_delta') {
      if (data?.delta?.type === 'text_delta')     text      += data.delta.text ?? '';
      if (data?.delta?.type === 'thinking_delta') thinkText += data.delta.thinking ?? '';
    }
    if (evType === 'message_delta' && data?.usage) usage = data.usage;
  }
  return { text: text.trim(), thinkText, evTypes, usage };
}

// Разбор OpenAI SSE
function parseOpenAISSE(raw) {
  if (raw.trimStart().startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      return { text: j.choices?.[0]?.message?.content?.trim() ?? '', evTypes: ['(json)'], usage: j.usage };
    } catch {}
  }
  let text = '', reasoning = '', usage = null;
  for (const block of raw.split('\n\n')) {
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data: ') || t === 'data: [DONE]') continue;
      try {
        const j = JSON.parse(t.slice(6));
        const d = j.choices?.[0]?.delta ?? {};
        if (d.content)           text      += d.content;
        if (d.reasoning_content) reasoning += d.reasoning_content;
        if (j.usage)             usage = j.usage;
      } catch {}
    }
  }
  return { text: text.trim(), reasoning, usage };
}

function fmt(r) {
  if (!r.ok) return R('✗') + ` ${r.ms}ms  ${R(r.error)}`;
  const ans   = r.text ? G(`"${r.text.slice(0, 60)}"`) : Y('(no text)');
  const think = r.thinkText ? D(` think:${r.thinkText.slice(0, 25)}…`) : '';
  const u     = r.usage ? D(` in:${r.usage.input_tokens ?? r.usage.prompt_tokens} out:${r.usage.output_tokens ?? r.usage.completion_tokens}`) : '';
  return G('✓') + ` ${r.ms}ms  ${ans}${think}${u}`;
}

async function run(url, endpoint, headers, bodyObj) {
  const t0 = Date.now();
  try {
    const r = await post(`${url}${endpoint}`, headers, bodyObj);
    const ms = Date.now() - t0;
    if (r.status !== 200) return { ok: false, ms, error: `HTTP ${r.status}: ${r.body.slice(0, 100)}` };
    return { ok: true, ms, ...parseAnthropicSSE(r.body) };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e) }; }
}

console.log(B('\n═══ Proxy Test ═══\n'));

// Import from built dist (run `npm run build` first)
const { startOpenAIProxy }           = await import('/path/to/agento/dist/src/proxy/openai-proxy.js');
const { startAnthropicScrubberProxy } = await import('/path/to/agento/dist/src/proxy/anthropic-scrubber.js');

const oaiProxy = await startOpenAIProxy({ upstreamUrl: UPSTREAM });
const scrubber  = await startAnthropicScrubberProxy({ upstreamUrl: UPSTREAM });
console.log(`openai-proxy: ${oaiProxy.url}\nscrubber:     ${scrubber.url}\n`);

const ANTH_H = { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' };

for (const m of MODELS) {
  const reasoning = m.reasoning ? Y(' [reasoning]') : '';
  console.log(`\n${B(m.label)}${reasoning}  ${D(m.id)}`);

  // 1. Direct (Anthropic endpoint)
  const body = { model: m.id, messages: [{ role: 'user', content: PROMPT }], max_tokens: m.maxTokens };
  console.log('  direct   stream    ' + fmt(await run(UPSTREAM, '/messages', ANTH_H, { ...body, stream: true })));
  console.log('  direct   non-stream ' + fmt(await run(UPSTREAM, '/messages', ANTH_H, { ...body, stream: false })));

  // 2. OpenAI proxy (Anthropic format → proxy → OpenAI)
  console.log('  oai-px   stream    ' + fmt(await run(oaiProxy.url, '/v1/messages', ANTH_H, { ...body, stream: true })));
  console.log('  oai-px   non-stream ' + fmt(await run(oaiProxy.url, '/v1/messages', ANTH_H, { ...body, stream: false })));

  // 3. Scrubber (Anthropic passthrough with field stripping)
  const bodyScrub = { ...body, context_management: { type: 'auto' } }; // should be stripped
  console.log('  scrubber stream    ' + fmt(await run(scrubber.url, '/v1/messages', ANTH_H, { ...bodyScrub, stream: true })));
  console.log('  scrubber non-stream ' + fmt(await run(scrubber.url, '/v1/messages', ANTH_H, { ...bodyScrub, stream: false })));
}

await oaiProxy.stop(); await scrubber.stop();
console.log(B('\n═══ Done ═══\n'));
```

## Известные особенности провайдеров

| Поведение | Причина | Как обрабатывается |
|-----------|---------|-------------------|
| Сервер возвращает `text/event-stream` даже для `stream:false` | Особенность конкретных провайдеров | `parseAnthropicSSE` обрабатывает оба формата |
| `stream:false` возвращает чистый JSON | Другие провайдеры | `parseAnthropicSSE` сначала пробует JSON |
| `delta.reasoning_content` вместо `delta.content` | Reasoning-модели (kimi, glm, cerebras) | Прокси игнорирует, пропускает только финальный `content` |
| Reasoning-модели с маленьким `max_tokens` | Токены уходят на thinking, ответа нет | `maxTokens ≥ 300–500` для reasoning-моделей |
| `: x-omniroute-*` SSE-комментарии | Метаданные роутинга провайдера | `sseLineToEvent` правильно игнорирует `:` строки |

## Проверка scrubbing

`context_management` должен быть вырезан до отправки в upstream. Проверка через echo-сервер:

```js
const { startAnthropicScrubberProxy } = await import('.../dist/src/proxy/anthropic-scrubber.js');
const echo = http.createServer((req, res) => {
  const c = []; req.on('data', d => c.push(d));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(c).toString());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: Object.keys(body) }));
  });
});
await new Promise(r => echo.listen(0, '127.0.0.1', r));
const proxy = await startAnthropicScrubberProxy({ upstreamUrl: `http://127.0.0.1:${echo.address().port}` });

const r = await post(proxy.url + '/v1/messages', {}, {
  model: 'x', messages: [], max_tokens: 1,
  context_management: { type: 'auto' }, keep_this: true,
});
const { keys } = JSON.parse(r.body);
console.assert(!keys.includes('context_management'), 'scrubbed ✓');
console.assert(keys.includes('keep_this'), 'preserved ✓');

await proxy.stop(); echo.close();
```

## Зависимости

- Сборка проекта: `npm run build` (dist/src/proxy/*.js)
- Импорт: `/path/to/agento/dist/src/proxy/openai-proxy.js` и `anthropic-scrubber.js`
- Node.js ≥18, только встроенные модули (`node:http`)
