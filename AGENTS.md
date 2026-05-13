# AgentO — Agent Instructions

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
│   │   ├── copilot.ts         # Адаптер Copilot CLI
│   │   └── goose.ts           # Адаптер Goose
│   ├── agents/
│   │   └── registry.ts        # Единый registry агентов: adapter, command, args, installer, label
│   ├── cli/commands/          # CLI команды (Commander)
│   │   ├── launch.ts          # agento launch
│   │   ├── provider.ts        # agento provider
│   │   ├── profile.ts         # agento profile
│   │   ├── restore.ts         # agento restore
│   │   └── agent.ts           # agento agent
│   ├── config/                # Конфигурация AgentO
│   │   ├── schema.ts          # Zod-схемы и типы
│   │   ├── store.ts           # Чтение/запись ~/.agento/config.json
│   │   ├── validation.ts      # Доменная валидация providers/profiles (008)
│   │   └── atomic-write.ts    # Атомарная запись файлов с mode 0o600 (009/010)
│   ├── installers/            # Установщики агентов (TUI Install Wizard)
│   │   ├── base.ts            # Интерфейс AgentInstaller
│   │   ├── registry.ts        # Реестр установщиков
│   │   ├── claude-code.ts     # Установщик Claude Code
│   │   ├── opencode.ts        # Установщик OpenCode
│   │   ├── qwen.ts            # Установщик Qwen CLI
│   │   ├── codex.ts           # Установщик Codex CLI
│   │   ├── copilot.ts         # Установщик Copilot CLI
│   │   └── goose.ts           # Установщик Goose
│   ├── launcher/              # Запуск агентов
│   │   ├── child.ts           # Child mode (backup → patch → spawn → restore)
│   │   ├── independent.ts     # Independent mode (backup → patch → exec)
│   │   ├── transaction.ts     # Общий transaction layer: backup/write/env/cleanup
│   │   └── shell-path-resolver.ts  # Резолвинг PATH через login shell
│   ├── profiles/              # Управление профилями
│   │   └── profile-manager.ts
│   ├── providers/             # Управление провайдерами
│   │   └── provider-manager.ts
│   └── tui/                   # Terminal UI (Ink/React)
│       ├── App.tsx            # Корневой компонент, роутинг экранов
│       ├── start.ts           # Точка входа в TUI
│       ├── use-key-input.ts   # Хук для обработки клавиш
│       └── screens/           # Экраны TUI
│           ├── MainMenu.tsx
│           ├── LaunchAgent.tsx
│           ├── AgentInstall.tsx # Мастер установки агента
│           ├── Providers.tsx
│           ├── Profiles.tsx
│           ├── Agents.tsx
│           └── Settings.tsx
```

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
  }
}
```

### Provider

```typescript
{
  id: string (uuid);
  name: string;                 // "Fireworks AI"
  type: 'openai-compatible' | 'anthropic' | 'fireworks' | 'openrouter';
  apiKey: string;
  baseUrl?: string;             // URL для openai-compatible (обязателен), опционален для остальных (fireworks/openrouter имеют дефолтные URL)
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
- `dev?` — флаг разработки: скрывает агента из UI/CLI по умолчанию
- `configPaths(cwd?)` → `{ global, project }` — пути к конфигам агента
- `readConfig(scope, cwd?)` — читает текущий конфиг агента
- `snapshotConfigFiles?(scope, cwd?)` — опционально: описывает все физические файлы для backup manifest, если один logical scope затрагивает несколько файлов
- `buildConfig(profile, providers)` — генерирует конфиг агента из профиля
- `writeConfig(config, scope, cwd?)` — записывает конфиг
- `restoreConfigFile?(file, scope, cwd?)` — опционально: восстанавливает/удаляет конкретный файл из backup manifest для multi-file restore
- `buildEnv?(profile, providers)` — опционально: env-переменные для запуска

### Поддерживаемые агенты

| Агент | ID | Команда | Поддерживаемые типы | Формат конфига | Capability-флаги | Особенности |
|-------|-----|---------|---|---|---|---|
| Claude Code | `claude-code` | `claude` | `anthropic`, `fireworks`, `openrouter` | JSON (`~/.claude/settings.json`) | Игнорирует | Поддерживает tiers (small/base/smart). Только один провайдер на профиль. Для `openrouter` использует Anthropic Skin: `ANTHROPIC_AUTH_TOKEN` (Bearer) + пустой `ANTHROPIC_API_KEY`, БЕЗ `apiKeyHelper`. |
| OpenCode | `opencode` | `opencode` | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | JSON (`~/.config/opencode/config.json` или `./opencode.json`) | Пробрасывает в `models[<name>].modalities` | Префикс модели: `providerKey/model`. Для `openrouter` ключ провайдера всегда `openrouter`. |
| Qwen CLI | `qwen` | `qwen` | `openai-compatible`, `fireworks`, `openrouter` | JSON (`~/.qwen/settings.json`) | Пробрасывает в `generationConfig.modalities` | **modelProviders ключ всегда `"openai"`** для openai-compatible провайдеров. Группирует модели по baseUrl. |
| Codex CLI | `codex` | `codex` | `fireworks`, `openrouter` | TOML (`~/.codex/config.toml`) | Игнорирует | `dev: true` (скрыт по умолчанию). `wire_api: responses`. При `project` scope `model_providers`, `default_profile`, `profiles` пишет в global config, а `model` — в project config; backup/restore manifest содержит оба файла. Использует `buildEnv` для инжекта API ключа. |
| Copilot CLI | `copilot` | `gh copilot` | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | — (env-only) | Игнорирует | Конфиг через env vars, `writeConfig` — no-op |
| Goose | `goose` | `goose` | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | — (env-only) | Игнорирует | `GOOSE_PROVIDER`/`GOOSE_MODEL`/`OPENAI_HOST`; `writeConfig` — no-op |

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

## CLI команды

### Запуск

```bash
# Интерактивный TUI (default)
agento
# Показать development agents (e.g. codex):
agento --dev

# Запуск агента напрямую
agento launch -p <profile> -a <agent> [-m child|independent] [-s global|project]

# Примеры:
agento launch -p default -a claude-code
agento launch -p default -a qwen -m child -s project
# Запуск development агента:
agento launch -p default -a codex --dev
```

### Управление провайдерами

```bash
agento provider list
agento provider add -n "Fireworks AI" -t openai-compatible -k "sk-..." -u "http://..." -M "model1,model2"
agento provider remove <name>
```

### Управление профилями

```bash
agento profile list
agento profile add -n "default" -m "providerId:modelName:base,providerId:model2:smart"
agento profile remove <name>
```

### Прочее

```bash
agento agent status           # Статус конфигов агентов
agento agent status --dev     # Показать статус включая development agents
agento restore -a <agent> -s <scope>  # Восстановить конфиг любого registry-агента из бэкапа
```

## Режимы запуска

### Child Mode (default)

1. Backup текущего конфига агента → v2 manifest `~/.agento/backups/<agent>/<scope>.bak.json` (`hadFile`, `cwd`, files metadata)
2. Записать новый конфиг (сгенерированный из профиля)
3. Запустить агента как child process
4. После завершения: восстановить оригинальный конфиг или удалить файл, если до launch его не было
5. SIGTERM/SIGINT: пробрасываются дочернему процессу, затем cleanup

Шаги подготовки (backup → write config → env/PATH → cleanup factory) выполняет `src/launcher/transaction.ts`. `prepareChild` — тонкая обертка для TUI, а `launchChild` использует тот же prepared `ExecRequest`, что и TUI.

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

- **MainMenu**: Выбор раздела (↑↓, Enter, Esc/q)
- **LaunchAgent**: Двухшаговый выбор (профиль → агент → запуск)
- **Providers**: ↑↓ navigate | Enter/a: add | e: edit | d: delete | Esc: back. В режиме edit: `[+ add model]` row → Enter добавляет модель, `i`/`v`/`a` переключают image/video/audio для выделенной модели, `e` редактирует имя, `d` удаляет
- **Profiles**: В списке ↑↓ navigate | Enter: детали | a: add | d: delete | Esc: back. В деталях профиля: ↑↓ navigate models | a: add model | d: delete model | e: edit | Esc: back. При выборе модели в add/edit wizard рядом с именем отображаются capability-маркеры
- **Agents**: Просмотр статуса конфигов (global/project, backup наличие)
- **Settings**: Настройки по умолчанию

Важно: перед передачей управления child process TUI вызывает `process.stdin.pause()` чтобы сбросить состояние stdin.

Агенты с `dev: true` (например, Codex CLI) скрыты из TUI и CLI по умолчанию. Чтобы показать их, используйте `agento --dev` или `agento launch --dev`.

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
| `src/launcher/child.test.ts` | Child launch flow (backup/restore) |
| `src/launcher/independent.test.ts` | Independent launch backup flow |
| `src/launcher/transaction.test.ts` | Общий launch transaction: backup/write/env/cleanup |
| `src/launcher/transaction.codex.test.ts` | Codex project multi-file transaction, cleanup и no-overwrite policy |
| `src/agents/registry.test.ts` | Единый registry агентов, порядок, `dev`-фильтр, default args |
| `src/cli/commands/restore.test.ts` | CLI restore через registry, валидация scope, удаление backup |
| `src/cli/commands/restore.codex.test.ts` | Crash-like CLI restore для Codex project multi-file backup |
| `src/launcher/shell-path-resolver.test.ts` | Резолвинг PATH |
| `src/profiles/profile-manager.test.ts` | CRUD профилей |
| `src/providers/provider-manager.test.ts` | CRUD провайдеров |

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
- CLI restore использует `src/agents/registry.ts` с `{ dev: true }`, поэтому поддерживает все зарегистрированные агенты (`claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`) без отдельного `--dev` флага и удаляет backup после успешного restore

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

> Порядок: сначала обновляешь код, потом документацию, потом коммитишь всё вместе.

## Дополнительные инструкции

- Все адаптеры должны поддерживать `readConfig` → `buildConfig` → `writeConfig` pipeline
- При добавлении нового агента нужно: создать адаптер, при необходимости создать installer, добавить одну запись в `src/agents/registry.ts`, расширить `AgentIdSchema` в `src/config/schema.ts` и добавить focused tests. CLI launch/status, TUI launch/status и install wizard должны брать список из registry, без локальных полных списков агентов.
- Провайдеры типа `anthropic` не поддерживаются Qwen (проверяется в адаптерах)
- BaseUrl обязателен для openai-compatible провайдеров (кроме Claude Code, который использует официальный API по умолчанию). Для `fireworks` и `openrouter` есть дефолтные URL: `https://api.fireworks.ai/inference/v1` и `https://openrouter.ai/api/v1`
- Тип `openrouter` поддерживается всеми 4 агентами. OpenRouter предоставляет три API-формата (OpenAI Chat Completions, Anthropic Skin, Responses API), что позволяет использовать его с Claude Code (Anthropic Skin), OpenCode/Qwen (OpenAI-compatible) и Codex (Responses API)
