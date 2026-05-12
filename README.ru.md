# AgentO — Менеджер конфигураций AI-агентов

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Управляйте конфигурациями AI-агентов с помощью профилей и провайдеров. Переключайтесь между моделями, провайдерами и агентами без лишних усилий.

AgentO — это CLI-инструмент для централизованного управления конфигурациями популярных AI-агентов для программирования. Задайте API-провайдеры один раз, создайте профили с разными комбинациями моделей и переключайтесь между ними одной командой.

**English version:** [README.md](README.md)

## Поддерживаемые агенты

| Агент | Команда | Формат конфига | Поддерживаемые провайдеры | Особенности |
|-------|---------|----------------|---|-------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic`, `fireworks`, `openrouter` | Поддержка уровней (small/base/smart) |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | Полная поддержка function calling через Vercel AI SDK; пробрасывает модальности |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter` | Структура OpenAI-совместимого API; пробрасывает модальности |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `fireworks`, `openrouter` | Инжект переменных окружения. Скрыт по умолчанию (флаг `--dev`). |
| [Copilot CLI](https://github.com/github/gh-copilot) | `gh copilot` | только env-переменные | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | Весь конфиг передаётся через переменные окружения — файл настроек не изменяется. |

## Поддерживаемые типы провайдеров

| Тип провайдера | Совместимые агенты | Примеры |
|---|---|---|
| `anthropic` | claude-code, opencode, copilot | Anthropic |
| `openai-compatible` | opencode, qwen, copilot | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek и т. д. |
| `fireworks` | claude-code, opencode, qwen, codex, copilot | Fireworks AI (поддерживает все 3 типа API) |
| `openrouter` | claude-code, opencode, qwen, codex, copilot | [OpenRouter](https://openrouter.ai) — универсальный шлюз (Anthropic Skin / OpenAI / Responses API) |

**Примечания:**
- `claude-code` работает с `anthropic`, `fireworks` и `openrouter` (требование Anthropic SDK). Для `openrouter` использует **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer).
- `copilot` работает со всеми 4 типами провайдеров; конфиг передаётся через переменные окружения, файл настроек не изменяется.
- Для других OpenAI-совместимых провайдеров используйте `opencode`, `qwen` или `copilot`.
- `openrouter` наиболее универсален — работает со всеми 5 агентами.

## Флаги возможностей моделей

Каждая модель внутри провайдера хранит три флага возможностей:

- **`image`** — модель принимает изображения на вход
- **`video`** — модель принимает видео на вход
- **`audio`** — модель принимает аудио на вход

Значения по умолчанию при добавлении: `image=true`, `video=false`, `audio=false`.

**Формат маркера:** в TUI и `agento provider list` возможности отображаются как `[iva]` (всё включено), `[i--]` (только image), `[---]` (только текст) и т. п. Маркер информационный — он **никогда** не записывается в конфиг агента.

**Зачем это нужно:**
- **Qwen** получает `generationConfig.modalities` из этих флагов (раньше всё было захардкожено в `false` — изображения не работали).
- **OpenCode** генерирует на каждую модель `modalities: { input: ["text", "image", ...], output: ["text"] }`, чтобы агент знал, что модель принимает.
- **Claude Code** и **Codex** пока эти флаги игнорируют (Anthropic SDK и Codex `responses` API не имеют поля для модальностей).

**Переключение возможностей:** TUI → Провайдеры → Edit, наведите курсор на модель и нажимайте `i` / `v` / `a`, чтобы переключать флаги. Новые модели добавляются строкой `[+ add model]` (Enter). CLI `provider add -M ...` создаёт модели с дефолтными значениями.

> Конфиги, созданные старыми версиями (с `string[]` моделями), мигрируются автоматически при чтении с дефолтными значениями возможностей.

## Установка

### Глобальная установка (рекомендуется)

```bash
npm install -g @emaxe/agento
```

### Локальная установка

```bash
npm install --save-dev @emaxe/agento
npx @emaxe/agento
```

### Требования

- Node.js ≥ 18
- Один или несколько установленных CLI-инструментов поддерживаемых агентов

## Быстрый старт

### 1. Добавьте API-провайдер

```bash
# OpenAI-совместимый провайдер (например, Fireworks AI)
agento provider add \
  -n "Fireworks AI" \
  -t openai-compatible \
  -k "sk-your-api-key" \
  -u "https://api.fireworks.ai/inference/v1" \
  -M "accounts/fireworks/models/llama-v3p1-70b-instruct,accounts/fireworks/models/kimi-k2p6"

# Провайдер Anthropic
agento provider add \
  -n "Anthropic" \
  -t anthropic \
  -k "sk-ant-your-key" \
  -M "claude-sonnet-4-20250514,claude-3-5-haiku-20241022"
```

### 2. Создайте профиль

```bash
# Профиль с одной моделью
agento profile add -n "default" -m "provider-id:claude-sonnet-4-20250514"

# Многоуровневый профиль (требуются уровни: small/base/smart)
agento profile add -n "multi" -m "provider-id:claude-3-5-haiku-20241022:small,provider-id:claude-sonnet-4-20250514:base,provider-id:claude-opus-4-20250514:smart"
```

### 3. Запустите агента

```bash
# Интерактивный TUI-режим (по умолчанию)
agento

# Прямой запуск
agento launch -p default -a claude-code

# Запуск с указанием режима и области видимости
agento launch -p default -a qwen -m child -s project
```

## Интерактивный TUI

Запуск `agento` без аргументов открывает интерактивный терминальный интерфейс (TUI), построенный на [Ink](https://github.com/vadimdemedes/ink) и React.

### Главное меню

```
┌────────── AgentO v0.2.0 ──────────┐
│                                   │
│ ▶  Запустить агента               │
│    Провайдеры                     │
│    Профили                        │
│    Агенты                         │
│    Настройки                      │
│                                   │
└───────────────────────────────────┘
```

**Навигация:** **↑↓** перемещение, **Enter** выбор, **Esc / q** выход.

### Обзор экранов

| Экран | Возможности | Горячие клавиши |
|-------|-------------|-----------------|
| **Запуск агента** | Выбор профиля → агента → запуск; статус установки кешируется на диск; при ENOENT — перезапуск TUI с ошибкой | **Enter** выбор, **Esc** назад |
| **Провайдеры** | Просмотр, добавление, редактирование, удаление провайдеров; переключение возможностей моделей | **Enter** детали / добавить модель, **a** добавить провайдер, **e** редактировать, **d** удалить, **i/v/a** переключить флаг, **Esc** назад |
| **Профили** | Просмотр, добавление, удаление профилей. В деталях: добавление/удаление/редактирование моделей | **Enter** детали, **a** добавить, **d** удалить, **Esc** назад |
| **Агенты** | Проверка статуса конфигов (global/project), наличие бэкапов | **Enter** детали, **Esc** назад |
| **Настройки** | Изменение режима запуска и области конфига; выделенная настройка показывает описание текущего значения | **↑↓** навигация, **Enter/Space** переключение, **Esc** сохранить и назад |

### Сценарий запуска агента

1. **Выбор профиля** — выберите один из сохранённых профилей
2. **Выбор агента** — AgentO проверяет статус установки всех агентов (спиннер). Незаконченные агенты отмечены `(not installed)`. Статусы кешируются в `~/.agento/agent-status.json` — при следующем открытии уже известные агенты не перепроверяются.
   - Агент **установлен** → переходим к запуску
   - Агент **не установлен** → открывается **Мастер установки**
   - Команда не найдена при запуске (ENOENT) → TUI перезапускается с ошибкой, агент помечается как не установленный
3. **Запуск** — AgentO применяет конфиг агента и запускает его

```
Profile: default
├─ Agent: claude-code
├─ Mode: child
├─ Scope: global
└─ [ Запуск ]
```

В **режиме child** после выхода агента вы вернётесь в AgentO, а оригинальный конфиг будет автоматически восстановлен.

В **режиме independent** AgentO завершается сразу, а изменённый конфиг остаётся на месте.

### Экран провайдеров

Управляйте API-провайдерами без необходимости запоминать CLI-флаги:

- **Просмотр** всех провайдеров с типом, моделями, маркерами возможностей и base URL
- **Добавление** нового провайдера с подсказками (имя, тип, API-ключ, модели, base URL)
- **Редактирование** существующих провайдеров — включая флаги возможностей моделей (`i`/`v`/`a`)
- **Удаление** ненужных провайдеров

В режиме редактирования модели отображаются как `▶ [i--] model-name`. Когда выделена модель, нажимайте `i` / `v` / `a`, чтобы переключать image / video / audio. Используйте строку `[+ add model]` (Enter) для добавления моделей, `d` — удалить, `e` — переименовать.

### Экран профилей

Организуйте конфигурации моделей:

- **Просмотр** всех профилей с моделями и уровнями
- **Добавление** профилей с одной или несколькими моделями
- **В деталях профиля:** добавление/удаление/редактирование отдельных моделей

### Экран агентов

Следите за статусом конфигураций агентов:

- Увидеть, есть ли у каждого агента **глобальный** или **проектный** конфиг
- Проверить, есть ли **бэкапы** (признак того, что AgentO ранее изменял конфиг)
- Посмотреть пути к конфигам для каждого агента

### Экран настроек

Настройте поведение AgentO по умолчанию:

| Настройка | Варианты | Описание |
|-----------|----------|----------|
| **Режим запуска по умолчанию** | `child` / `independent` | Как запускать агентов по умолчанию |
| **Область конфига по умолчанию** | `global` / `project` | Куда записывать конфиги агентов |

При навигации выделенная настройка показывает пояснение к текущему значению прямо под строкой.

**Управление:** **↑↓** навигация, **Enter** или **Space** переключение значений, **Esc** сохранить и вернуться.

### TUI vs CLI

| Задача | TUI | CLI |
|--------|-----|-----|
| Визуальный просмотр провайдеров | ✅ | — |
| Быстрый разовый запуск | — | `agento launch -p <p> -a <a>` |
| Автоматизация скриптами | — | ✅ |
| Проверка статуса конфига | ✅ | `agento agent status` |
| Пошаговое создание провайдера/профиля | ✅ | Ручная сборка флагов |

Используйте **TUI** для изучения и интерактивных сценариев. Используйте **CLI** для скриптов, алиасов и быстрых запусков.

## Справочник по CLI

### `agento` — Главная команда

По умолчанию запускает интерактивный TUI.

```bash
agento          # Запуск интерактивного TUI
agento --dev    # Показать development-агентов (например, codex) в TUI
```

### `agento launch` — Запуск агента

```bash
agento launch -p <profile> -a <agent> [options]

Опции:
  -p, --profile <name>   Имя профиля (обязательно)
  -a, --agent <id>       Агент: claude-code, opencode, qwen, codex (обязательно)
  -m, --mode <mode>      Режим запуска: child или independent (по умолчанию из настроек)
  -s, --scope <scope>    Область конфига: global или project (по умолчанию из настроек)
  -d, --dev              Показать development-агентов (например, codex)
```

**Режимы запуска:**

- **Child** (по умолчанию): Временно заменяет конфиг агента, запускает его, восстанавливает оригинальный конфиг при выходе
- **Independent**: Постоянно заменяет конфиг; восстановление вручную

**Области конфига:**

- **Global**: `~/.<agent>/settings.*`
- **Project**: `./.<agent>/settings.*` или `./<agent>.*`

### `agento provider` — Управление провайдерами

```bash
agento provider list                          # Список всех провайдеров (с маркерами возможностей)
agento provider add [options]                 # Добавить провайдер
  -n, --name <name>         Отображаемое имя (обязательно)
  -t, --type <type>         Тип: anthropic, openai-compatible или fireworks (обязательно)
  -k, --api-key <key>       API-ключ (обязательно)
  -u, --base-url <url>      Base URL (обязателен для openai-compatible, опциональный для других)
  -M, --models <models>     Список моделей через запятую (обязательно). Возможности по умолчанию:
                            image=true, video=false, audio=false. Меняйте в TUI клавишами i/v/a.
agento provider remove <name>                 # Удалить провайдер
```

**Дефолты Base URL:**
- `anthropic`: использует стандартный endpoint Anthropic
- `fireworks`: автоматически `https://api.fireworks.ai/inference`, если не указан
- `openai-compatible`: должен быть указан явно через `-u`

### `agento profile` — Управление профилями

```bash
agento profile list                           # Список всех профилей
agento profile add [options]                  # Добавить профиль
  -n, --name <name>         Имя профиля (обязательно)
  -m, --models <models>     Список providerId:modelName[:tier] через запятую (обязательно)
                            Tier опционален для одномодельных профилей.
                            Для многоуровневых: tier должен быть small|base|smart, минимум один base.
agento profile remove <name>                  # Удалить профиль
```

### `agento agent` — Статус агентов

```bash
agento agent status                           # Статус конфигов всех агентов
agento agent status --dev                     # Включая development-агентов (например, codex)
```

### `agento restore` — Восстановление конфига

```bash
agento restore -a <agent> -s <scope>          # Восстановить конфиг агента из бэкапа

Опции:
  -a, --agent <id>         ID агента (обязательно)
  -s, --scope <scope>      Область конфига: global или project (обязательно)
```

## Конфигурация

AgentO хранит свою конфигурацию в `~/.agento/config.json`:

```json
{
  "providers": [
    {
      "id": "uuid",
      "name": "Fireworks AI",
      "type": "fireworks",
      "apiKey": "fw-...",
      "models": [
        { "name": "accounts/fireworks/models/llama-v3p1-70b-instruct", "capabilities": { "image": false, "video": false, "audio": false } },
        { "name": "accounts/fireworks/models/kimi-k2", "capabilities": { "image": true, "video": false, "audio": false } }
      ]
    }
  ],
  "profiles": [
    {
      "id": "uuid",
      "name": "default",
      "models": [
        {
          "providerId": "uuid",
          "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
          "tier": "base"
        }
      ]
    }
  ],
  "settings": {
    "defaultLaunchMode": "child",
    "defaultConfigScope": "global",
    "independentMode": "pty"
  }
}
```

> Конфиги, созданные AgentO < 0.2.0, имеют `models` как массив строк. Они мигрируются автоматически при чтении; возможности по умолчанию `{ image: true, video: false, audio: false }`, меняются в TUI.

## Как это работает

### Адаптеры агентов

Каждый поддерживаемый агент имеет адаптер, который переводит универсальный формат AgentO в специфичный конфиг агента:

- **Claude Code** (`anthropic`, `fireworks`, `openrouter`): Генерирует `~/.claude/settings.json` с выбором модели по уровням и переменными окружения `ANTHROPIC_*`. Использует Anthropic SDK. Для `openrouter` использует **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer). Флаги возможностей не пробрасываются.
- **OpenCode** (`anthropic`, `openai-compatible`, `fireworks`, `openrouter`): Генерирует `~/.config/opencode/config.json` через Vercel AI SDK. Полная поддержка function calling через `@ai-sdk/openai-compatible`. Для каждой модели генерируется `modalities: { input: [...], output: ["text"] }` из флагов возможностей.
- **Qwen CLI** (`openai-compatible`, `fireworks`, `openrouter`): Генерирует `~/.qwen/settings.json` со структурой OpenAI-совместимого провайдера. Требует `baseUrl`. Пробрасывает флаги возможностей через `generationConfig.modalities`.
- **Codex CLI** (`--dev` для отображения): Генерирует `~/.codex/config.toml` с `wire_api: responses`, профилями и ссылками на переменные окружения. При project-области разделяет конфиг между глобальным (`model_providers`) и проектным (`model`) конфигами. Флаги возможностей не пробрасываются.
- **Copilot CLI** (все 4 типа провайдеров): Не записывает и не изменяет файл настроек. Весь конфиг передаётся через `COPILOT_MODEL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BASE_URL`. Типы `fireworks` и `openrouter` отображаются как `COPILOT_PROVIDER_TYPE=openai`. Для моделей семейства gpt-5 автоматически добавляется `COPILOT_PROVIDER_WIRE_API=responses`.

### Бэкап и восстановление

Перед изменением любого конфига агента AgentO создаёт бэкап в `~/.agento/backups/<agent>/<scope>.bak.*`.

В **режиме Child** оригинальный конфиг автоматически восстанавливается при выходе агента или получении SIGTERM/SIGINT.

В **режиме Independent** конфиг остаётся изменённым. Восстановите вручную через `agento restore`.

## Разработка

### Настройка

```bash
git clone https://github.com/emaxe/agentO.git
cd agentO
npm install
```

### Скрипты

```bash
npm run build      # Компиляция TypeScript в dist/
npm run dev        # Режим наблюдения
npm test           # Запуск всех тестов
npm run test:watch # Режим наблюдения для тестов
npm run typecheck  # Проверка типов TypeScript
npm run lint       # ESLint
npm run format     # Prettier
```

### Архитектура

```
src/
├── adapters/         # Адаптеры конфигов для конкретных агентов
├── cli/commands/     # Реализация CLI-команд
├── config/           # Схема и хранилище конфига
├── launcher/         # Логика запуска агентов
├── profiles/         # Управление профилями
├── providers/        # Управление провайдерами
└── tui/              # Терминальный UI (Ink + React)
```

## Устранение неполадок

### Изменения в `src/` не применяются

Глобальная команда AgentO использует скомпилированный код из `dist/`, а не `src/`. После любых изменений исходников:

```bash
npm run build
```

### Тесты проходят, но глобальная команда ведёт себя иначе

Папка `dist/` устарела. Пересоберите:

```bash
npm run build
```

### В конфиге Qwen CLI отображается "omni" вместо "openai"

Это был баг в версиях < 0.1.1. Обновитесь до последней версии или пересоберите.

## Участие в проекте

Вклад приветствуется! Пожалуйста:

1. Форкните репозиторий
2. Создайте ветку с фичей
3. Напишите тесты для новой функциональности
4. Убедитесь, что все тесты проходят (`npm test`)
5. Отправьте pull request

## Лицензия

[MIT](LICENSE) © AgentO Contributors
