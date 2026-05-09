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
- **node-pty** (optional) для PTY-режима запуска

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
│   │   └── codex.ts           # Адаптер Codex CLI
│   ├── cli/commands/          # CLI команды (Commander)
│   │   ├── launch.ts          # agento launch
│   │   ├── provider.ts        # agento provider
│   │   ├── profile.ts         # agento profile
│   │   ├── restore.ts         # agento restore
│   │   └── agent.ts           # agento agent
│   ├── config/                # Конфигурация AgentO
│   │   ├── schema.ts          # Zod-схемы и типы
│   │   └── store.ts           # Чтение/запись ~/.agento/config.json
│   ├── launcher/              # Запуск агентов
│   │   ├── child.ts           # Child mode (backup → patch → spawn → restore)
│   │   ├── independent.ts     # Independent mode (backup → patch → exec)
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
    independentMode: 'spawn-detached' | 'pty';
  }
}
```

### Provider

```typescript
{
  id: string (uuid);
  name: string;                 // "Fireworks AI"
  type: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseUrl?: string;             // URL для openai-compatible
  models: string[];           // Доступные модели провайдера
}
```

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
- `buildConfig(profile, providers)` — генерирует конфиг агента из профиля
- `writeConfig(config, scope, cwd?)` — записывает конфиг
- `buildEnv?(profile, providers)` — опционально: env-переменные для запуска

### Поддерживаемые агенты

| Агент | ID | Команда | Формат конфига | Особенности |
|-------|-----|---------|----------------|-------------|
| Claude Code | `claude-code` | `claude` | JSON (`~/.claude/settings.json`) | Поддерживает tiers (small/base/smart). Только один провайдер на профиль. |
| OpenCode | `opencode` | `opencode` | JSON (`~/.config/opencode/config.json` или `./opencode.json`) | Префикс модели: `providerKey/model`. |
| Qwen CLI | `qwen` | `qwen` | JSON (`~/.qwen/settings.json`) | **modelProviders ключ всегда `"openai"`** для openai-compatible провайдеров. Группирует модели по baseUrl. |
| Codex CLI | `codex` | `codex` | TOML (`~/.codex/config.toml`) | `dev: true` (скрыт по умолчанию). `wire_api: responses`. При `project` scope `model_providers` пишет в global config, а `model` — в project config. Использует `buildEnv` для инжекта API ключа. |

### Важная деталь: Qwen Adapter

Для Qwen CLI ключ в `modelProviders` всегда должен быть `"openai"` (не зависит от имени провайдера). Это требование самого Qwen для OpenAI-совместимых провайдеров.

```typescript
// src/adapters/qwen.ts
const providerKey = 'openai';  // Было: provider.name.toLowerCase().replace(/\s+/g, '-')
```

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
agento restore -a <agent> -s <scope>  # Восстановить конфиг из бэкапа
```

## Режимы запуска

### Child Mode (default)

1. Backup текущего конфига агента → `~/.agento/backups/<agent>/<scope>.bak.json`
2. Записать новый конфиг (сгенерированный из профиля)
3. Запустить агента как child process
4. После завершения: восстановить оригинальный конфиг
5. SIGTERM/SIGINT: пробрасываются дочернему процессу, затем cleanup

### Independent Mode

1. Backup текущего конфига
2. Записать новый конфиг
3. Вернуть `ExecRequest` для запуска внешним процессом
4. Восстановление конфига — ответственность пользователя (или через `agento restore`)

## TUI (Terminal UI)

Запускается по умолчанию при вызове `agento` без аргументов.

- **MainMenu**: Выбор раздела (↑↓, Enter, Esc/q)
- **LaunchAgent**: Двухшаговый выбор (профиль → агент → запуск)
- **Providers**: ↑↓ navigate | Enter/a: add | e: edit | d: delete | Esc: back
- **Profiles**: В списке ↑↓ navigate | Enter: детали | a: add | d: delete | Esc: back. В деталях профиля: ↑↓ navigate models | a: add model | d: delete model | e: edit | Esc: back
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

- Перед любым изменением конфига агента делается бэкап в `~/.agento/backups/`
- Child mode гарантирует восстановление при любом исходе (exit, SIGTERM, SIGINT)
- Independent mode оставляет конфиг изменённым — восстановление через `agento restore`

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

> Порядок: сначала обновляешь код, потом документацию, потом коммитишь всё вместе.

## Дополнительные инструкции

- Все адаптеры должны поддерживать `readConfig` → `buildConfig` → `writeConfig` pipeline
- При добавлении нового агента нужно: создать адаптер, добавить в `AGENT_COMMANDS` (launch.ts), добавить в TUI (`LaunchAgent.tsx`), добавить тесты
- Провайдеры типа `anthropic` не поддерживаются Qwen и OpenCode (проверяется в адаптерах)
- BaseUrl обязателен для openai-compatible провайдеров (кроме Claude Code, который использует официальный API по умолчанию)
