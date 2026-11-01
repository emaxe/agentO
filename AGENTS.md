# AgentO — Agent Instructions

## Скиллы

- **proxy-test** (`.agents/skills/proxy-test/SKILL.md`) — шаблон для тестирования прокси-серверов agento против реального API. Триггер: `/proxy-test` или задачи вида "протестируй прокси", "проверь провайдера через прокси".

## Общее описание

AgentO — CLI-инструмент для управления конфигурациями AI-агентов. Позволяет создавать **профили** (наборы моделей) и **провайдеры** API, а затем запускать различных агентов (Claude Code, OpenCode, Qwen CLI, Codex CLI) с нужной конфигурацией через единый интерфейс.

## Стек

- **TypeScript 5.5** + **Node.js ≥18**
- **ES Modules** (`"type": "module"` в package.json)
- **Vitest** для тестирования (тесты запускаются напрямую с `src/`)
- **`tsc`** для компиляции `src/` + `bin/` → `dist/`
- **Commander** для CLI
- **Ink + React** для TUI (Terminal User Interface)
- **Zod** для валидации схем
- **smol-toml** для работы с TOML (Codex adapter)

## Структура проекта

```
/Users/maksimklisin/Desktop/_JS/agento/
├── bin/agento.ts              # Entry point CLI
├── src/
│   ├── adapters/              # Адаптеры конфигов агентов
│   │   ├── base.ts            # Базовый интерфейс AgentAdapter
│   │   ├── claude-code.ts     # Адаптер Claude Code
│   │   ├── opencode.ts        # Адаптер OpenCode
│   │   ├── qwen.ts            # Адаптер Qwen CLI
│   │   ├── codex.ts           # Адаптер Codex CLI
│   │   ├── copilot.ts         # Адаптер Copilot
│   │   ├── goose.ts           # Адаптер Goose
│   │   ├── pi.ts              # Адаптер PI
│   │   ├── kilo.ts            # Адаптер Kilo Code
│   │   ├── kimi.ts            # Адаптер Kimi Code
│   │   ├── hermes.ts          # Адаптер Hermes Agent / Hermes Desktop
│   │   ├── resolve-base-model.ts # Выбор base-модели профиля
│   │   └── merge-config.ts    # Хелпер conservative merge для адаптеров
│   ├── agents/
│   │   └── registry.ts        # Единый registry агентов: adapter, command, args, installer, label
│   ├── cli/commands/          # CLI команды (Commander)
│   │   ├── launch.ts          # agento launch
│   │   ├── provider.ts        # agento provider
│   │   ├── profile.ts         # agento profile
│   │   ├── restore.ts         # agento restore (--list, scope/agent inference)
│   │   ├── agent.ts           # agento agent (status --json, installed version)
│   │   ├── config.ts          # agento config path
│   │   └── doctor.ts          # agento doctor (read-only diagnostics)
│   ├── config/                # Конфигурация AgentO
│   │   ├── schema.ts          # Zod-схемы и типы
│   │   ├── store.ts           # Чтение/запись ~/.agento/config.json
│   │   ├── ui-state.ts        # ~/.agento/ui-state.json: last launch (profile/agent/mode/scope)
│   │   ├── mask.ts            # Маскирование API-ключей для TUI/CLI
│   │   ├── validation.ts      # Доменная валидация providers/profiles (008)
│   │   ├── atomic-write.ts    # Атомарная запись файлов с mode 0o600 (009/010)
│   │   └── version.ts         # Динамическое чтение версии из package.json
│   ├── installers/            # Установщики агентов (TUI Install Wizard)
│   │   ├── base.ts            # Интерфейс AgentInstaller
│   │   ├── registry.ts        # Тонкий wrapper над src/agents/registry.ts
│   │   ├── claude-code.ts     # Установщик Claude Code
│   │   ├── opencode.ts        # Установщик OpenCode
│   │   ├── qwen.ts            # Установщик Qwen CLI
│   │   ├── codex.ts           # Установщик Codex CLI
│   │   ├── copilot.ts         # Установщик Copilot
│   │   ├── goose.ts           # Установщик Goose
│   │   ├── pi.ts              # Установщик PI
│   │   ├── kilo.ts            # Установщик Kilo Code
│   │   ├── kimi.ts            # Установщик Kimi Code
│   │   └── hermes.ts          # Установщик Hermes Agent / Hermes Desktop
│   ├── launcher/              # Запуск агентов
│   │   ├── child.ts           # Child mode (backup → patch → spawn → restore)
│   │   ├── independent.ts     # Independent mode (backup → patch → exec)
│   │   ├── transaction.ts     # Общий transaction layer: backup/write/env/cleanup/proxy
│   │   ├── preview.ts         # Read-only preview: files/env keys/backup/git-exclude/warnings
│   │   └── shell-path-resolver.ts  # Резолвинг PATH через login shell
│   ├── platform/              # Кроссплатформенный слой (единственное место, где живут win32-развилки)
│   │   ├── spawn.ts           # spawnCommand/spawnCommandSync: cross-spawn + резолв .cmd/.exe; ENOENT вместо exit 1
│   │   ├── resolve-executable.ts  # Поиск команды по PATH/PATHEXT из env запуска
│   │   ├── env.ts             # getEnvCI/setEnvCI: регистронезависимый env, один ключ PATH
│   │   └── kill-tree.ts       # killTree: taskkill /T /F на win32, child.kill на POSIX
│   ├── proxy/                 # HTTP-прокси для адаптации запросов
│   │   ├── anthropic-scrubber.ts  # Вырезание неподдерживаемых полей Anthropic API (context_management) для Claude Code через сторонние провайдеры
│   │   ├── openai-proxy.ts    # OpenAI Chat Completions → Anthropic Messages (включая SSE)
│   │   ├── responses-proxy.ts # Anthropic Messages → OpenAI Responses API (включая SSE)
│   │   └── proxy-utils.ts     # Общие хелперы прокси
│   ├── profiles/              # Управление профилями
│   │   └── profile-manager.ts
│   ├── providers/             # Управление провайдерами
│   │   └── provider-manager.ts
│   ├── test-utils/            # paths.ts (p/posix/win32 для ожиданий), spawn-fakes.ts
│   ├── tui/                   # Terminal UI (Ink/React)
│   │   ├── App.tsx            # Корневой компонент, роутинг экранов
│   │   ├── start.ts           # Точка входа в TUI
│   │   ├── run-loop.ts        # Цикл TUI → spawn агента → cleanup → relaunch
│   │   ├── use-key-input.ts   # Хук для обработки клавиш (ЙЦУКЕН → QWERTY)
│   │   ├── keyboard-layout.ts # Маппинг ЙЦУКЕН → QWERTY: клавиши и текстовые поля (API-ключ)
│   │   ├── use-help.ts        # `?` help: открытие/закрытие и перехват клавиш
│   │   ├── provider-api.ts    # Сетевой слой формы провайдера (test API / fetch models)
│   │   ├── tier-options.ts    # Допустимые tier-опции профиля (без повторов и skip для multi-model)
│   │   ├── components/        # SelectList (viewport), TextField, StatusLine, HelpOverlay
│   │   ├── hooks/
│   │   │   └── useLaunchWizard.ts # Машина состояний мастера запуска (profile/agent/preview/install/edit-profile/recovery)
│   │   ├── wizards/
│   │   │   └── ProfileWizard.tsx  # Мастер добавления профиля
│   │   └── screens/           # Экраны TUI (MainMenu, LaunchAgent, LaunchPreview, Providers, Profiles, Agents, Settings, формы)
```

## Кроссплатформенность (macOS / Linux / Windows)

Поддерживаются macOS, Linux и Windows 10 1809+/11. Подробности и статус проверок —
`docs/windows-support/report.md`, пути конфигов агентов — `docs/windows-support/config-paths.md`.

Правила (нарушение ломает Windows, а на Linux/macOS тесты этого не покажут):

- **Процессы — только через `src/platform/spawn.ts`** (`spawnCommand`/`spawnCommandSync`). Прямой
  импорт `node:child_process`/`child_process` запрещён ESLint (`no-restricted-imports`). Исключения:
  `src/platform/**`, тесты и `src/launcher/shell-path-resolver.ts` (POSIX login-shell probe, на win32 не исполняется).
- **`process.platform` читать только в `src/platform/*`** либо принимать `platform` параметром (инъекция,
  по образцу `ShellPathResolverOptions.platform`). Глубоко в коде глобал не читать — иначе win32-ветка
  не тестируется на Linux.
- **Новые тесты не используют POSIX-литералы путей** (`'/home/x'`, `'/tmp/...'`) в ожиданиях. Платформа —
  параметр; пути строить через `src/test-utils/paths.ts` (`p` — как рантайм на хосте, `posix`/`win32` —
  явное представление). Не заменять всё скопом на `p`: это скрывает `\` на POSIX. Тесты, требующие
  реального `.cmd`/`taskkill`, — `*.windows.test.ts` с `skipIf` вне win32.
- **win32-нюансы:**
  - переменная PATH называется `Path`; env собирать через `getEnvCI`/`setEnvCI`, чтобы остался один ключ;
  - домашний каталог — `homedir()`, не `process.env.HOME` (в cmd/PowerShell `HOME` не задан);
  - npm-CLI на Windows — `.cmd`-шимы: запускать их через `spawnCommand`, а не `spawn(..., {shell:false})`;
    несуществующая команда должна давать `ENOENT`, а не `exit 1` от `cmd.exe`;
  - завершение агента — `killTree` (`taskkill /T /F`); `process.kill(-pid)` не использовать;
  - graceful SIGTERM на Windows нет: восстановление после hard-kill — отложенное (pid в манифесте бэкапа);
  - `rename`/`unlink` на Windows ретраятся (`EPERM/EACCES/EBUSY`) — писать файлы через `atomic-write`.
- Изменения в `encodeCwdForBackup` и других путях бэкапа ветвить строго по `platform`, иначе на POSIX
  осиротеют активные бэкапы (закреплено golden-тестами).

## Система конфигурации

### AgentO Config

Хранится в `~/.agento/config.json`:

```typescript
{
  providers: Provider[];      // API провайдеры
  profiles: Profile[];          // Профили с моделями
  settings: {
    defaultLaunchMode: 'child' | 'independent';
    defaultConfigScope: 'global' | 'project';
    mergeAgentConfigs: boolean; // default: true — conservative merge при записи конфигов агентов
  }
}
```

### Provider

```typescript
{
  id: string (uuid);
  name: string;                 // "Fireworks AI"
  type: 'openai-compatible' | 'anthropic-compatible' | 'fireworks' | 'openrouter' | 'responses-compatible';
  apiKey: string;
  baseUrl?: string;             // URL для openai-compatible и responses-compatible (обязателен), опционален для остальных (fireworks/openrouter имеют дефолтные URL)
  models: ModelConfig[];        // Доступные модели провайдера
}

// ModelConfig (с capability-флагами)
{
  name: string;                 // "claude-3-opus", "accounts/fireworks/models/kimi-k2"
  capabilities: {
    image: boolean;             // default: true
    video: boolean;             // default: false
    audio: boolean;             // default: false
  };
}
```

**Миграция:** конфиги старого формата (`models: string[]`) автоматически мигрируются при чтении в `ModelConfig[]` с дефолтными возможностями. Перезаписываются на следующем save.

**Capability-маркер:** `capabilityMarker(caps)` → `[iva]`, `[i--]`, `[---]` и т. п. Используется в TUI и `agento provider list` для отображения. Никогда не попадает в конфиги агентов.

### Profile

```typescript
{
  id: string (uuid);
  name: string;
  models: Array<{
    providerId: string (uuid);
    model: string;
    tier?: 'small' | 'base' | 'smart';  // Для multi-tier профилей
  }>;
}
```

## Адаптеры агентов

Все адаптеры реализуют интерфейс `AgentAdapter` из `src/adapters/base.ts`:

- `id` — уникальный идентификатор
- `displayName` — человекочитаемое имя
- `dev?` — legacy-флаг разработки: если выставлен, скрывает агента из UI/CLI. Сейчас ни один адаптер его не выставляет; `--dev` принимается для обратной совместимости и ничего не меняет
- `envOnly?` — конфиг передаётся только через env-переменные (`writeConfig` — no-op, файлы не создаются и не бэкапятся). Выставлен у `copilot` и `goose`; preview показывает «environment variables only» и не выдумывает файлы
- `configPaths(cwd?)` → `{ global, project }` — пути к конфигам агента
- `readConfig(scope, cwd?)` — читает текущий конфиг агента
- `snapshotConfigFiles?(scope, cwd?)` — опционально: описывает все физические файлы для backup manifest, если один logical scope затрагивает несколько файлов
- `buildConfig(profile, providers)` — генерирует конфиг агента из профиля
- `writeConfig(config, scope, cwd?, mergeEnabled?)` — записывает конфиг. При mergeEnabled=true сохраняет неизвестные ключи из существующего конфига (shallow merge, nested — replace целиком, env — flat merge через mergeAgentConfig)
- `restoreConfigFile?(file, scope, cwd?)` — опционально: восстанавливает/удаляет конкретный файл из backup manifest для multi-file restore
- `buildEnv?(profile, providers)` — опционально: env-переменные для запуска

### Поддерживаемые агенты

| Агент | ID | Команда | Поддерживаемые типы | Формат конфига | Capability-флаги | Особенности |
|-------|-----|---------|---|---|---|---|
| Claude Code | `claude-code` | `claude` | `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible` | JSON (`~/.claude/settings.json`) | Игнорирует | Поддерживает tiers (small/base/smart), только один провайдер на профиль. Для `openrouter` — Anthropic Skin: `ANTHROPIC_AUTH_TOKEN` + пустой `ANTHROPIC_API_KEY`, без `apiKeyHelper`. Для `fireworks`/`openrouter` поднимается `anthropic-scrubber`, для `openai-compatible` — `openai-proxy`, для `responses-compatible` — `responses-proxy`. |
| OpenCode | `opencode` | `opencode` | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | JSON (`~/.config/opencode/config.json` или `./opencode.json`) | Пробрасывает в `models[<name>].modalities` | Префикс модели: `providerKey/model`. Для `openrouter` ключ провайдера всегда `openrouter`. |
| Qwen CLI | `qwen` | `qwen` | `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | JSON (`~/.qwen/settings.json`) | Пробрасывает в `generationConfig.modalities` | **modelProviders ключ всегда `"openai"`**. Группирует модели по baseUrl. Модели, требующие `max_completion_tokens` (o-series, gpt-5+/gpt-6+, а также неизвестные имена на `api.openai.com`; legacy `gpt-4.x` остаётся прямым), на время запуска идут через `src/proxy/openai-param-proxy.ts`: `baseUrl` в `modelProviders` указывает на loopback-proxy, `envKey` остаётся от реального URL, cleanup останавливает proxy. |
| Codex CLI | `codex` | `codex` | `openai-compatible`, `responses-compatible`, `fireworks`, `openrouter`, `custom-api` | TOML (`$CODEX_HOME/config.toml` или `~/.codex/config.toml`) | Игнорирует | `wire_api: responses`. При `project` scope `model_providers`, `default_profile`, `profiles` пишет в global config, а `model` — в project config; backup/restore manifest содержит оба файла. Использует `buildEnv` для инжекта API ключа. |
| Copilot | `copilot` | `copilot` | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | — (env-only) | Игнорирует | Конфиг через env vars, `writeConfig` — no-op. |
| Goose | `goose` | `goose` | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | — (env-only) | Игнорирует | `GOOSE_PROVIDER`/`GOOSE_MODEL`/`OPENAI_HOST`; `writeConfig` — no-op. На Windows конфиг — `%APPDATA%\Block\goose\config\config.yaml`. |
| PI | `pi` | `pi` | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | JSON (`~/.pi/agent/settings.json` + `models.json`) | Игнорирует | `defaultProvider`/`defaultModel`; кастомный `baseUrl` — в `models.json`. |
| Kilo Code | `kilo` | `kilo` | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | JSON (`~/.kilocode/settings.json` + `models.json`) | Игнорирует | `defaultProvider`/`defaultModel`; кастомный `baseUrl` — в `models.json`. |
| Kimi Code | `kimi` | `kimi` | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | TOML (`~/.kimi/config.toml`, legacy `~/.kimi/config.json` читается) | Игнорирует | `default_model`, `providers.<name>` (`type`, `base_url`, `api_key`), `models.<name>`; project и global указывают на один файл. |
| Hermes Agent | `hermes` | `hermes` | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | YAML (`$HERMES_HOME/config.yaml`, иначе `~/.hermes/config.yaml`; на Windows `%LOCALAPPDATA%\hermes\config.yaml`) | Игнорирует | `model` (`provider`, `default`, `base_url`, `api_key`) + `providers.<key>` (`name`, `api`, `api_key`, `default_model`, `models`, `transport`). Ключ провайдера — `agento-<slug>` (не перекрывает встроенные slug'и Hermes). `chat_completions` не пишется (дефолт Hermes), `anthropic_messages`/`codex_responses` — явно. Требует зависимости `yaml`; merge правит `model` и `providers` по ключам, остальное (`toolsets`, `gateway`, `hooks`, `_config_version`) сохраняется. `api_key` пишется инлайн: Desktop переиспользует уже запущенный Electron-инстанс, env при повторном запуске не подхватывается. |
| Hermes Desktop | `hermes-desktop` | `hermes desktop` | те же 6 | тот же `config.yaml`, что у CLI | Игнорирует | Тот же адаптер; первый запуск собирает Electron-приложение (долго), повторные — быстрые. Оба scope указывают на один файл: project-конфига у Hermes нет. |

### Локальные proxy

Для не-`anthropic-compatible` провайдеров Claude Code AgentO поднимает локальный HTTP-proxy на случайном порту `127.0.0.1`:

- `fireworks` / `openrouter` — `anthropic-scrubber.ts` (удаляет поля вроде `context_management`);
- `openai-compatible` — `openai-proxy.ts` (OpenAI Chat Completions → Anthropic Messages, включая SSE); для gpt-6+ с function tools выставляет `reasoning_effort: "none"`, потому что Chat Completions не поддерживает tools вместе с reasoning, и повторяет запрос по соответствующей 400-й;
- `responses-compatible` — `responses-proxy.ts` (Anthropic Messages → OpenAI Responses API, включая SSE).

Тот же механизм локальных proxy используется и для Qwen CLI: модели, требующие `max_completion_tokens`, на время запуска идут через прозрачный OpenAI-to-OpenAI pass-through `openai-param-proxy.ts` — см. подраздел «Qwen parameter proxy» ниже.

#### Anthropic Scrubber

При запуске Claude Code с провайдерами `openrouter` или `fireworks` (то есть через Anthropic-совместимые endpoints, а не нативный Anthropic API), AgentO автоматически поднимает локальный HTTP-proxy (`src/proxy/anthropic-scrubber.ts`) на случайном порту `127.0.0.1`.

**Зачем:** Claude Code, как официальный клиент Anthropic, отправляет в запросах поля, специфичные для нативного Anthropic API (например, `context_management` для управления контекстным окном). Сторонние провайдеры (OpenRouter, Fireworks) не поддерживают эти поля и отвечают `400 Extra inputs are not permitted`.

**Как работает:**
- Proxy перехватывает исходящие от Claude Code POST-запросы (`/v1/messages` и др.)
- Для запросов с `Content-Type: application/json` парсит тело, рекурсивно удаляет поля из denylist (по умолчанию `['context_management']`), сериализует обратно и пересылает на upstream
- Все остальные запросы (GET, POST без JSON) проксируются прозрачно
- Ответы от upstream pipe'ятся напрямую клиенту без буферизации, сохраняя SSE-стриминг
- Proxy запускается в процессе AgentO перед стартом Claude Code и автоматически останавливается в cleanup-хуке после выхода агента
- В `ANTHROPIC_BASE_URL` конфига Claude Code подставляется адрес локального proxy вместо реального upstream

**Denylist:** настраивается через `denyList` параметр `startAnthropicScrubberProxy`. По умолчанию:
```typescript
['context_management']
```

#### Qwen parameter proxy

При запуске Qwen CLI модели, которые отклоняют `max_tokens` и требуют `max_completion_tokens`, на время запуска идут через прозрачный OpenAI-to-OpenAI proxy (`src/proxy/openai-param-proxy.ts`) на случайном порту `127.0.0.1`. Qwen CLI сам собирает Chat Completions-запросы и хардкодит `max_tokens`, поэтому AgentO меняет параметр на лету — без протокольной трансляции.

**Routing (`shouldProxyModel`):** запись `modelProviders[*]` проходит через proxy, если

- имя модели требует `max_completion_tokens`: o-series (`o1`, `o3`, `o4`, …), `gpt-5+` и `gpt-6+`; префикс провайдера (например `openai/…`) отбрасывается перед сравнением имени модели;
- либо резолвленный `baseUrl` указывает на `api.openai.com` — страховка для новых семейств OpenAI, которых ещё нет в эвристике имён. Это coverage net, а не blanket: имена, которые эвристика уже классифицирует как legacy (`gpt-N`, N < 5, например `gpt-4.x`), принимают `max_tokens` и остаются прямыми.

Qwen-native модели, DeepSeek, Ollama и сторонние OpenAI-совместимые шлюзы через proxy не идут — их `baseUrl` остаётся прямым.

**Как работает:**
- после записи конфига qualifying-записи группируются по `baseUrl`, поднимается один proxy на каждый distinct upstream (обычно один); если proxy не стартовал — launch падает до запуска агента, тихого fallback нет;
- в записанном конфиге переписывается только `baseUrl` qualifying-записей: `http://127.0.0.1:<port>` + исходный path upstream (путь и query пересылаются в upstream verbatim, `/v1` не нормализуется); `envKey` — имя env-переменной с реальным API-ключом — а также `id`, `name` и `generationConfig` не меняются, proxy пересылает `Authorization`-заголовок Qwen как есть;
- в теле JSON-запроса для qualifying-модели `max_tokens` заменяется на `max_completion_tokens`; всё остальное (GET, не-JSON тела, ответы, SSE) проходит без изменений;
- для gpt-6+ при наличии `tools` выставляется `reasoning_effort: "none"`: Chat Completions не поддерживает function tools вместе с reasoning (gpt-5.x ещё поддерживает), иначе upstream отвечает `400 Function tools with reasoning_effort are not supported`. На этой 400-й есть такой же одноразовый retry с `reasoning_effort: "none"` — страховка для незнакомых семейств;
- если `reasoning_effort` не помогает (reasoning-only семейства `gpt-6.1-sol` и `gpt-6-astra` отвечают `400 ... does not support 'none'`, а с любым другим значением — `400 Function tools with reasoning_effort are not supported`), запрос с `tools` один раз переигрывается через `<baseUrl>/responses` (`src/proxy/chat-responses-adapter.ts`): сообщения, `tool_calls`, результаты инструментов, картинки и `tools` переводятся в формат Responses, ответ (JSON или SSE с tool-calls) переводится обратно в Chat Completions. Sampling-параметры, которые Responses API этих моделей отвергает (`temperature`, `top_p`, `stop`, `seed`, `presence_penalty`, `frequency_penalty`, `logit_bias`), отбрасываются, `reasoning_effort: "none"` не передаётся (модель выбирает сама), `tool_calls[].id` = `call_id`, чтобы следующий ход с результатом инструмента совпал. Вторая попытка моста не делается: ошибка Responses-эндпоинта возвращается как есть, а не-JSON ответ (например 404 от шлюза без `/responses`) — исходной 400-й с подсказкой про `/v1/responses`;
- `accept-encoding: identity` форсируется для всех upstream-запросов proxy, иначе сжатое тело 400 не распарсить и ни один детектор не сработает;
- если upstream ответил `400`, чей текст называет оба параметра (`isMaxTokensUnsupportedError` — страховая сеть для моделей, которые эвристика не узнала), тело один раз переотправляется с `max_completion_tokens`; второй `400` возвращается агенту без изменений;
- cleanup launch-транзакции останавливает все поднятые proxy; патченный конфиг пишется без merge, поэтому restore после запуска возвращает оригинальный конфиг целиком.

### Важная деталь: Qwen Adapter

Для Qwen CLI ключ в `modelProviders` всегда должен быть `"openai"` (не зависит от имени провайдера). Это требование самого Qwen для OpenAI-совместимых провайдеров.

```typescript
// src/adapters/qwen.ts
const providerKey = 'openai';  // Было: provider.name.toLowerCase().replace(/\s+/g, '-')
```

## Install Wizard / Installers

The TUI includes an install wizard (`AgentInstall.tsx`) that triggers when a user selects an agent that is not yet installed on the system.

Each supported agent has a dedicated installer under `src/installers/` that implements the `AgentInstaller` interface from `src/installers/base.ts`:

- **`checkInstalled()`** — runs the agent's `--version` command to detect presence and extract version.
- **`checkEnvironment()`** — verifies prerequisites (e.g. `npm` is available for auto-install).
- **`install()`** — performs a global `npm install -g <package>` and captures stderr for error reporting.
- **`manualInstructions`** — provides the exact install command and docs URL shown in manual-install mode.

**Registry:** единый source of truth находится в `src/agents/registry.ts`. Он хранит `id`, `label`, `adapter`, `command`, optional `args` и optional `installer` для каждого агента. `src/installers/registry.ts` оставлен thin wrapper для совместимости и не должен содержать отдельный полный список агентов.

| Agent | Package | Docs URL |
|-------|---------|----------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | https://docs.anthropic.com/en/docs/claude-code/setup |
| OpenCode | `npm install -g opencode` | https://opencode.ai/docs |
| Qwen CLI | `npm install -g @qwen-code/qwen-code@latest` | https://github.com/QwenLM/qwen-code |
| Codex CLI | `npm install -g @openai/codex` | https://github.com/openai/codex |
| Hermes Agent / Hermes Desktop | `curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash -s -- --skip-setup` (Windows: `irm https://hermes-agent.nousresearch.com/install.ps1` с `-SkipSetup`) | https://github.com/NousResearch/hermes-agent |

## CLI команды

### Запуск

```bash
# Интерактивный TUI (default)
agento
# --dev оставлен для совместимости; все агенты показываются всегда
agento --dev

# Запуск агента напрямую
agento launch -p <profile> -a <agent> [-m child|independent] [-s global|project]

# Примеры:
agento launch -p default -a claude-code
agento launch -p default -a qwen -m child -s project
agento launch -p default -a codex
# Без -p/-a — последний запуск; префиксы допустимы:
agento launch -p wor -a clau
# Показать, что будет записано, ничего не меняя:
agento launch -p default -a claude-code --dry-run
```

### Управление провайдерами

```bash
agento provider list [--json]
agento provider add -n "Fireworks AI" -t openai-compatible -k "sk-..." -u "http://..." -M "model1,model2"
agento provider add -n "Acme" -t openai-compatible -k "sk-..." -u "https://api.acme.test/v1" --fetch-models
agento provider edit <name> -M "model1,model2"
agento provider test <name>
agento provider remove <name>
```

### Управление профилями

```bash
agento profile list
agento profile add -n "default" -m "providerNameOrId:modelName:base,providerNameOrId:model2:smart"
# provider — имя провайдера (регистронезависимо) или UUID; обе формы валидны
agento profile remove <name>
```

### Прочее

```bash
agento agent status [--json]  # Статус конфигов + версия установленных агентов
agento agent status --dev     # Устарело: все агенты показываются всегда
agento restore -a <agent> -s <scope>  # Восстановить конфиг любого registry-агента из бэкапа
agento restore --list         # Активные бэкапы для текущего каталога
agento restore -a qwen        # scope выводится, если активен один бэкап
agento config path [--json]   # Пути config/ui-state/backups
agento doctor [--json]        # Диагностика: версии, конфиг, бэкапы, установленные агенты
```

## Режимы запуска

### Child Mode (default)

1. Backup текущего конфига агента → v2 manifest `~/.agento/backups/<agent>/<scope>.bak.json` (`hadFile`, `cwd`, files metadata)
2. Записать новый конфиг (сгенерированный из профиля)
3. Запустить агента как child process
4. После завершения: восстановить оригинальный конфиг или удалить файл, если до launch его не было
5. SIGTERM/SIGINT: пробрасываются дочернему процессу, затем cleanup

Код выхода child-запуска совпадает с кодом агента. Если агент убит сигналом, возвращается `128 + номер сигнала`; если команда не найдена (`ENOENT`) — `127`, как в independent-режиме. Для агентов с `envOnly` backup/write/git-exclude не выполняются: конфиг передаётся только через env.

Шаги подготовки (backup → write config → env/PATH → cleanup factory) выполняет `src/launcher/transaction.ts`. `prepareChild` — тонкая обертка для TUI, а `launchChild` использует тот же prepared `ExecRequest`, что и TUI.

Подготовка запуска и восстановление сериализуются между процессами через `src/config/config-operation.ts`. Активные manifest-бэкапы резервируют физические файлы: пересечение блокирует запуск даже между разными scope и cwd. Cleanup проверяет sessionId, чтобы не восстановить чужую новую сессию.

Если active backup для этого agent/scope уже существует, запуск останавливается до записи нового конфига. Сначала нужно выполнить `agento restore -a <agent> -s <scope>`.

### Independent Mode

1. Backup текущего конфига в v2 manifest
2. Записать новый конфиг
3. Вернуть `ExecRequest` для запуска внешним процессом
4. Восстановление конфига — ответственность пользователя (или через `agento restore`)

Independent mode использует тот же `src/launcher/transaction.ts` для backup/write/env, но не вызывает cleanup автоматически.

Повторный independent launch с тем же agent/scope не перезаписывает active backup; пользователь должен восстановить предыдущий backup перед новым launch.

## TUI (Terminal UI)

Запускается по умолчанию при вызове `agento` без аргументов.

- **MainMenu**: Первое действие `Launch last` (`r`) или `Set up AgentO`, далее New launch / Profiles / Providers / Agents & recovery / Settings (1–6). Показывает cwd, сводку прошлого запуска, активные backups (`b` открывает первый) и раздельные результаты агента/cleanup после child-запуска.
- **LaunchAgent**: Двухшаговый выбор (профиль → агент → запуск). Внизу обоих шагов футер `Profile / mode (m) / scope (s)` — `m`/`s` переключают child/independent и project/global для этого запуска (дефолты берутся из Settings). `AgentSelect` показывает версию установленного агента (`v1.2.3`). Новые/изменённые сочетания открывают review автоматически; знакомые запускаются сразу, `v` всегда открывает review. При `Active backup already exists` для выбранного scope предлагается `Restore previous config and launch`; пересечения shared files направляют в recovery. `t` раскрывает ошибку; `r` повторяет; `a` открывает recovery. `i` раскрывает причины несовместимости, `e` открывает ProfileEdit и возвращает в мастер.
- **SetupWizard**: Единый маршрут service/provider → connection/models → model → profile → agent → review → launch. Подтверждённые provider/profile сохраняются; ошибки загрузки моделей допускают ручной ввод. Черновик имени профиля сохраняется при возврате; сохранённый профиль используется повторно.
- **Providers**: ↑↓ navigate | Enter/a: add | e: edit | d: delete | Esc: back. В режиме edit: `[+ add model]` row → Enter добавляет модель, `i`/`v`/`a` переключают image/video/audio для выделенной модели, `e` редактирует имя, `d` удаляет
- **Profiles**: В списке ↑↓ navigate | Enter: детали | a: add | d: delete | Esc: back. В деталях профиля: ↑↓ navigate models | a: add model | d: delete model | e: edit | Esc: back. При выборе модели в add/edit wizard рядом с именем отображаются capability-маркеры. «Без tier» доступен только для одномодельного профиля; при добавлении второй модели мастер сначала просит назначить tier существующей
- **Agents & recovery**: `i/u/d` открывают install/update/uninstall (в launch оставлена только установка отсутствующего агента). Просмотр статуса конфигов (global/project, backup наличие); выделенная строка показывает путь к конфигу, `r` — restore через `restoreBackupForAgent` (полный манифест, multi-file безопасен) с подтверждением `y/Enter` и показом файлов manifest/статуса PID; ошибка остаётся в диалоге
- **Settings**: Настройки по умолчанию: `defaultLaunchMode`, `defaultConfigScope`, `mergeAgentConfigs`

- **Help**: `?` открывает контекстную панель (`HelpOverlay`) на главном меню, Providers/Profiles/Agents/Settings и шагах profile/agent; при открытой панели все клавиши перехватываются, закрытие — `?`/Esc/Enter. Логика в `use-help.ts`.
- **Поиск и viewport**: `/` фильтрует Providers, Profiles и Agents; `f` на экране Agents оставляет только modified. `SelectList` и списки моделей/агентов показывают окно и `↑/↓ N more`.
- **Preview**: `v` на шаге агента открывает `LaunchPreview` (read-only), `Enter` запускает, `Esc` возвращает. Тот же `describeLaunch` используется в `agento launch --dry-run`.
- **Сортировка агентов**: установленные агенты идут первыми, неизвестные — в середине, неустановленные — в конце; выбранный агент сохраняется по id при обновлении статусов.

Конвенция: **все UI-строки TUI на английском** (ЙЦУКЕН-маппинг прозрачен для пользователя); guard-тест `src/tui/english-ui.test.ts` не допускает кириллицу в rendered-строках `src/tui` (кроме `keyboard-layout.ts` — там карта маппинга). Маппинг применяется и к клавишам (`useKeyInput`), и к полю API-ключа в форме провайдера: ключ — ASCII-токен, поэтому кириллица там всегда означает неверную раскладку и молча чинится; имена провайдеров при этом остаются как введены (кириллица разрешена). Подтверждения удаления/отмены/восстановления: `y`/`Y`/Enter — подтвердить, `n`/`N`/Esc — отменить, остальной ввод игнорируется. Статус-сообщения — через общий `StatusLine` (красный для `Error: ...`); успех скрывается через 5 секунд, ошибка остаётся до следующего действия. Кэш статусов `~/.agento/agent-status.json` хранит `{installed, version?}` (старые boolean нормализуются при чтении). Last launch хранится в `~/.agento/ui-state.json` (`profileId`, `agentId`, `mode`, `scope`); битый файл игнорируется. `confirmedLaunch: {version: 1, fingerprint}` — SHA-256 от влияющих на запуск данных (включая credentials, cwd, mode/scope, config paths, merge). Сохраняется только digest после успешной подготовки подтверждённого запуска; секреты/сгенерированный config не сохраняются. Отсутствие или устаревшая версия требуют review.

Формы ProviderForm/ProfileWizard/ProfileEdit ожидают `Promise<void>` от callbacks сохранения, сами показывают ошибки и блокируют повторное сохранение. `DiscardChanges` выбирает Keep editing по умолчанию; Esc в редакторе имени модели отменяет только текущий черновик. API key скрыт по умолчанию (Ctrl+R). `useTerminalSize` имеет одну общую resize-подписку; `useViewport` ограничивает списки, `ScrollableLines` — длинные preview/help/reasons. Unicode-поиск передаётся в `useKeyInput` с `{textInput: true}` без ЙЦУКЕН-преобразования. Общий каркас новых экранов — `ScreenFrame`.

Важно: перед передачей управления child process TUI вызывает `process.stdin.pause()` чтобы сбросить состояние stdin.

Агенты с `dev: true` скрывались бы из TUI и CLI, но сейчас таких нет: все 11 входят в registry. Флаг `agento --dev` и `launch --dev` принимаются для совместимости и ничего не меняют.

## Тесты

```bash
npm test          # Запуск всех тестов
npm run test:watch  # Watch mode
```

Тестовые файлы (Vitest, Node environment):

| Файл | Что тестирует |
|------|---------------|
| `src/adapters/*.test.ts` | Генерацию конфигов для каждого агента |
| `src/config/store.test.ts` | Чтение/запись `~/.agento/config.json` и бэкапов |
| `src/config/atomic-write-exclusive.test.ts` | Атомарная публикация бэкапов: конкурентные записи, запрет перезаписи и очистка временных файлов |
| `src/config/config-operation.test.ts` | Межпроцессная блокировка, резервирование общих файлов, симлинки, legacy и повреждённые бэкапы |
| `src/config/backup-restore.test.ts` | Восстановление всех файлов, сохранение бэкапа при ошибке и повторная попытка |
| `src/config/ui-state.test.ts` | Кеш last launch: round-trip и терпимость к битому JSON |
| `src/config/mask.test.ts` | Маскирование API-ключей |
| `src/launcher/preview.test.ts` | Read-only preview: файлы, env-ключи, git-exclude, backup, env-only |
| `src/tui/components/SelectList.test.tsx` | Viewport и индикаторы скрытых строк |
| `src/tui/screens/help.test.tsx` | `?` help overlay |
| `src/cli/commands/provider.test.ts` | CLI provider list --json/edit/test/fetch-models |
| `src/cli/commands/agent.test.ts` | CLI agent status --json и текст |
| `src/cli/commands/doctor.test.ts` | Диагностика в JSON и тексте, ошибки конфигурации и проверки установленных агентов, коды выхода |
| `src/launcher/child.test.ts` | Child launch flow (backup/restore) |
| `src/launcher/independent.test.ts` | Independent launch backup flow |
| `src/launcher/transaction.test.ts` | Общий launch transaction: backup/write/env/cleanup |
| `src/launcher/transaction.codex.test.ts` | Codex project multi-file transaction, cleanup и no-overwrite policy |
| `src/agents/registry.test.ts` | Единый registry агентов, порядок, `dev`-фильтр, default args |
| `src/cli/commands/restore.test.ts` | CLI restore через registry, валидация scope, удаление backup |
| `src/cli/commands/restore.codex.test.ts` | Crash-like CLI restore для Codex project multi-file backup |
| `src/launcher/shell-path-resolver.test.ts` | Резолвинг PATH |
| `src/profiles/profile-manager.test.ts` | CRUD профилей, валидация изменений, перестановка моделей и граничные индексы |
| `src/providers/provider-manager.test.ts` | CRUD провайдеров, запрет удаления используемого провайдера |
| `src/tui/tier-options.test.ts` | Допустимые tier-опции профиля |
| `src/tui/screens/*.test.tsx` | Экраны TUI: меню, launch wizard, провайдеры, профили, агенты, настройки, подтверждения |
| `src/tui/screens/agent-install.test.tsx` | Автоустановка, ручные инструкции, отсутствующие зависимости, ошибки, retry и ввод во время установки |
| `src/tui/components/StatusLine.test.tsx` | Цвет статуса и поведение авто-скрытия |

Тесты работают напрямую с `src/` (не требуют сборки).

## Сборка и запуск (КРИТИЧЕСКИ ВАЖНО)

### Пересборка

**После ЛЮБЫХ изменений в `src/` или `bin/` обязательно пересобрать:**

```bash
npm run build
```

Это скомпилирует TypeScript в `dist/`.

### Почему это важно

- Глобальная команда `agento` (установленная через `npm link` или `npm install -g`) **запускает скомпилированный код из `dist/`**, а не исходники из `src/`.
- Если после правок в `src/` не пересобрать, глобальный `agento` будет использовать **устаревшую** версию из `dist/`.
- Тесты работают с `src/` напрямую, поэтому могут проходить, а глобальная команда при этом использовать старый код.

### Проверка после сборки

```bash
# Smoke check (входит в npm run prepublishOnly):
node dist/bin/agento.js --version

grep -n "providerKey" dist/src/adapters/qwen.js
# должно показать: const providerKey = 'openai';
```

### Разработка

```bash
npm run dev        # tsc --watch (автопересборка при изменениях)
npm run typecheck  # tsc --noEmit (проверка типов без сборки)
npm run lint       # ESLint
npm run format     # Prettier
```

## Ключевые паттерны

### Адаптеры

- Каждый адаптер изолирован и знает формат конфига своего агента
- `buildConfig` — чистая функция (не читает/не пишет файлы)
- `writeConfig` — единственное место записи конфига агента

### Conservative Config Merge

- `mergeAgentConfig(existing, generated, envKeys)` — shallow merge top-level ключей. Ключи из `existing`, которых нет в `generated`, сохраняются. Ключи из `generated` перезаписывают `existing`. Nested-объекты заменяются целиком. Ключи из `envKeys` (например `['env']`) мержатся flat: `{ ...existing.env, ...generated.env }`.
- Используется в `writeConfig` адаптеров Claude Code, Qwen, OpenCode при `mergeEnabled=true` (читается из `settings.mergeAgentConfigs`, default `true`).
- Copilot и Goose не используют (env-only, `writeConfig` — no-op). Codex использует собственную split-file merge-логику.
- Restore (backup-restore.ts) всегда вызывает `writeConfig` без `mergeEnabled` — exact replacement.

### Backup / Restore

- Перед любым изменением конфига агента делается active backup в `~/.agento/backups/<agent>/<scope>.bak.json`
- Launch backup/write/env/cleanup logic находится в `src/launcher/transaction.ts`; `child.ts` и `independent.ts` не должны дублировать `adapter.readConfig`/`adapter.snapshotConfigFiles` → `writeBackup`, `adapter.buildConfig` → `adapter.writeConfig` и merge env/PATH.
- Backup-файл хранится как v2 manifest: `version`, `sessionId`, `agentId`, `scope`, optional `cwd`, `createdAt`, `files[]` с `path`, `format`, `hadFile`, `content`
- `writeBackup` не перезаписывает существующий active backup для того же `agentId/scope`; новый launch должен упасть до `adapter.writeConfig` с инструкцией выполнить `agento restore -a <agent> -s <scope>`
- `readBackup` поддерживает legacy raw backup-файлы и нормализует их в v2-like manifest с одним файлом и `hadFile: true`
- Restore/cleanup использует `restoreBackupManifest(...)` и `hadFile`: single-file backups при `true` вызывают `adapter.writeConfig(content, scope, cwd?)`, при `false` удаляют config path вместо записи `{}`; multi-file backups должны восстанавливаться через `adapter.restoreConfigFile(...)`.
- Codex `project` scope — multi-file transaction: backup manifest содержит global `~/.codex/config.toml` и project `<cwd>/.codex/config.toml`; cleanup/CLI restore восстанавливает или удаляет оба файла без process-local state.
- Child mode гарантирует восстановление при любом исходе (exit, SIGTERM, SIGINT) и удаляет backup после успешного cleanup
- Independent mode оставляет конфиг изменённым — восстановление через `agento restore`
- CLI restore использует `src/agents/registry.ts` с `{ dev: true }`, поэтому поддерживает все зарегистрированные агенты (`claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`, `pi`, `kilo`, `kimi`, `hermes`, `hermes-desktop`) без отдельного `--dev` флага и удаляет backup после успешного restore

### Конфиг Scope

- `global` — конфиг в домашней директории (`~/.agent/...`)
- `project` — конфиг в текущей рабочей директории (`./.agent/...`)

### Multi-tier профили

- Если в профиле несколько моделей, каждая должна иметь `tier` (`small`, `base`, `smart`)
- Обязательно наличие хотя бы одной модели с `tier: 'base'`
- Одна модель в профиле — tier игнорируется

## Troubleshooting

### Изменения в src/ не применяются

**Причина:** Забыли `npm run build`. Глобальный `agento` использует `dist/`, не `src/`.

**Решение:**
```bash
npm run build
# Проверить
grep "const providerKey" dist/src/adapters/qwen.js
```

### Тесты проходят, но поведение глобальной команды другое

**Причина:** `dist/` устарел относительно `src/`.

**Решение:** `npm run build` и перезапуск.

## Чеклист перед публикацией (git / npm)

При любом изменении функциональности перед коммитом и публикацией в npm **обязательно**:

1. Обновить **`AGENTS.md`** — если изменился интерфейс адаптеров, структура конфига, CLI команды или TUI
2. Обновить **`README.md`** — если новая фича видна пользователю (новые флаги, агенты, команды, поведение)
3. Обновить **`CHANGELOG.md`** — добавить запись в секцию `[Unreleased]` с типом изменения (Added / Changed / Fixed / Removed)
4. Запустить **smoke check**: `npm run build && node dist/bin/agento.js --version` (входит в `npm run prepublishOnly`)
5. Убедиться, что **CI зелёный на всех трёх ОС**, включая **windows-job** (`windows-latest`, Node 20/22): он блокирующий. Публиковать при красном windows-job нельзя

> Порядок: сначала обновляешь код, потом документацию, потом коммитишь всё вместе.

## Дополнительные инструкции

- Все адаптеры должны поддерживать `readConfig` → `buildConfig` → `writeConfig` pipeline
- При добавлении нового агента нужно: создать адаптер, при необходимости создать installer, добавить одну запись в `src/agents/registry.ts`, расширить `AgentIdSchema` в `src/config/schema.ts` и добавить focused tests. CLI launch/status, TUI launch/status и install wizard должны брать список из registry, без локальных полных списков агентов.
- Провайдеры типа `anthropic` не поддерживаются Qwen (проверяется в адаптерах)
- BaseUrl обязателен для `responses-compatible` и `custom-api`. У `openai-compatible`, `fireworks`, `openrouter` и `anthropic-compatible` есть дефолтные URL (`https://api.openai.com/v1`, `https://api.fireworks.ai/inference/v1`, `https://openrouter.ai/api/v1`, `https://api.anthropic.com`); `agento provider add` без `-u` для них валиден
- Тип `openrouter` поддерживается всеми 4 агентами. OpenRouter предоставляет три API-формата (OpenAI Chat Completions, Anthropic Skin, Responses API), что позволяет использовать его с Claude Code (Anthropic Skin), OpenCode/Qwen (OpenAI-compatible) и Codex (Responses API)
