# AgentO — Менеджер конфигураций AI-агентов

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Управляйте конфигурациями AI-агентов с помощью профилей и провайдеров. Переключайтесь между моделями, провайдерами и агентами без лишних усилий.

AgentO — это CLI-инструмент для централизованного управления конфигурациями популярных AI-агентов для программирования. Задайте API-провайдеры один раз, создайте профили с разными комбинациями моделей и переключайтесь между ними одной командой.

**English version:** [README.md](README.md)

## Поддерживаемые агенты

| Агент | Команда | Формат конфига | Поддерживаемые провайдеры | Особенности |
|-------|---------|----------------|---|-------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible` | Поддержка уровней (small/base/smart). Для не-Anthropic провайдеров используется локальный proxy. |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Полная поддержка function calling через Vercel AI SDK; пробрасывает модальности |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Структура OpenAI-совместимого API; пробрасывает модальности |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `openai-compatible`, `responses-compatible`, `fireworks`, `openrouter`, `custom-api` | `wire_api: responses`. Профиль в отдельном `default.config.toml`. |
| [Kimi Code](https://www.kimi.com/code) | `kimi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Конфиг через `~/.kimi-cli/.env` (`DEFAULT_PROVIDER`, `DEFAULT_MODEL`, `BASE_URL`). |
| [Kilo Code](https://github.com/Kilo-Org/kilo-code) | `kilo` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Читает `defaultProvider`/`defaultModel` из `~/.kilocode/settings.json`. Кастомный `baseUrl` из `~/.kilocode/models.json`. |
| [PI](https://github.com/withpi/pi) | `pi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Читает `defaultProvider`/`defaultModel` из `~/.pi/agent/settings.json`. Кастомный `baseUrl` из `~/.pi/agent/models.json`. |
| [Copilot](https://github.com/github/gh-copilot) | `copilot` | только env-переменные | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Весь конфиг передаётся через переменные окружения — файл настроек не изменяется. |
| [Goose](https://goose-docs.ai) | `goose` | только env-переменные | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Весь конфиг через env vars (`GOOSE_PROVIDER`, `GOOSE_MODEL`). |

## Поддерживаемые типы провайдеров

| Тип провайдера | Совместимые агенты | Примеры |
|---|---|---|
| `openai-compatible` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek и т. д. |
| `anthropic-compatible` | claude-code, opencode, copilot, goose, pi, kilo, kimi | Anthropic и любой endpoint с Anthropic Messages API |
| `fireworks` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | Fireworks AI (поддерживает все 3 типа API) |
| `openrouter` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | [OpenRouter](https://openrouter.ai) — универсальный шлюз (Anthropic Skin / OpenAI / Responses API) |
| `responses-compatible` | claude-code, opencode, codex, copilot, goose, kilo, kimi | OpenAI и любой провайдер, поддерживающий OpenAI Responses API |
| `custom-api` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | Любой self-hosted endpoint или шлюз; протоколы задаются через `customApiModes` |

**Примечания:**
- `claude-code` работает со всеми 6 типами провайдеров. Для не-`anthropic-compatible` провайдеров используется локальный proxy: Anthropic Scrubber для `fireworks`/`openrouter`; OpenAI-to-Anthropic proxy для `openai-compatible`; Responses Proxy для `responses-compatible`. Для `openrouter` используется **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer).
- `copilot` и `goose` работают со всеми типами провайдеров; конфиг передаётся через переменные окружения, файл настроек не изменяется.
- `custom-api` — универсальный вариант для self-hosted endpoint или шлюза: задайте `baseUrl` и включите те протоколы, которые он реально поддерживает, через `customApiModes` (`openai`, `anthropic`, `responses`). Нужен хотя бы один режим. AgentO сам подставляет нужный суффикс: `/v1` для openai, ничего для anthropic (клиент сам добавляет `/v1/messages`), `/v1/responses` для responses.
- `qwen` и `codex` — единственные агенты, не поддерживающие `anthropic-compatible`; `qwen` и `pi` — единственные без `responses-compatible`.

## Ключи API и безопасность git

Ключи провайдеров хранятся в `~/.agento/config.json` (права `0700` на каталог, `0600` на файл) и передаются запускаемому агенту через переменные окружения. В сгенерированный конфиг агента они **не** записываются.

Важно понимать про **project scope**: в этом режиме AgentO пишет конфиг агента *внутрь вашего репозитория* (`.claude/settings.json`, `.codex/config.toml`, …), а часть этих путей принято коммитить — например, Claude Code считает `.claude/settings.json` общим файлом команды и гитигнорит только `settings.local.json`.

Поэтому при каждом запуске в project scope AgentO дописывает сгенерированные пути в `.git/info/exclude` и сообщает об этом:

```
Warning: Generated agent config may contain your API key; added to .git/info/exclude
so it is not committed: /.claude/settings.json
```

`.git/info/exclude` — локальный файл, он не коммитится, так что ваш собственный `.gitignore` остаётся нетронутым. Пути вне репозитория пропускаются, повторные запуски не плодят дубли. Если записать файл не удалось, AgentO сообщит об этом, но запуск не сорвёт — на такое предупреждение стоит обратить внимание перед коммитом.

Если вы предпочитаете, чтобы конфиги агентов вообще не попадали в репозитории, используйте `global` scope (`-s global` или Settings → Default config scope в TUI).

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
- **macOS или Linux.** Windows сейчас не поддерживается: и запуск агента, и его
  установка идут через `spawn(..., { shell: false })`, а установленные через npm CLI
  на Windows — это `.cmd`-шимы, которые так не запускаются. TUI откроется и управление
  конфигами работает, но агенты не стартуют, а в списке все показываются как
  «не установлены». Подробности и roadmap —
  [docs/windows-cross-platform-report.md](docs/windows-cross-platform-report.md).

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
  -t anthropic-compatible \
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
┌────────── AgentO v0.8.0 ──────────┐
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
| **Запуск агента** | Выбор профиля → агента → запуск; статус установки кешируется на диск; при ENOENT — перезапуск TUI с ошибкой. На установленном агенте: `u` — обновить, `d` — удалить | **Enter** выбор, **Esc** назад, **u** обновить, **d** удалить |
| **Провайдеры** | Просмотр, добавление, редактирование, удаление провайдеров; переключение возможностей моделей | **Enter** детали / добавить модель, **a** добавить провайдер, **e** редактировать, **d** удалить, **i/v/a** переключить флаг, **Esc** назад |
| **Профили** | Просмотр, добавление, удаление профилей. В деталях: добавление/удаление/редактирование моделей | **Enter** детали, **a** добавить, **d** удалить, **Esc** назад |
| **Агенты** | Проверка статуса конфигов (global/project), наличие бэкапов | **Enter** детали, **Esc** назад |
| **Настройки** | Изменение режима запуска и области конфига; выделенная настройка показывает описание текущего значения | **↑↓** навигация, **Enter/Space** переключение, **Esc** сохранить и назад |

### Сценарий запуска агента

1. **Выбор профиля** — выберите один из сохранённых профилей
2. **Выбор агента** — AgentO проверяет статус установки всех агентов (спиннер). Неустановленные агенты отмечены `(not installed)`. Установленные агенты при выделении показывают `(u update, d delete)`. Статусы кешируются в `~/.agento/agent-status.json` — при следующем открытии уже известные агенты не перепроверяются.
   - Агент **установлен** → нажмите **Enter** для запуска, **u** для обновления или **d** для удаления
   - Агент **не установлен** → открывается **Мастер установки**
   - Команда не найдена при запуске (ENOENT) → TUI перезапускается с ошибкой, агент помечается как не установленный
3. **Мастер установки** (при необходимости):
   - **Автоустановка** — проверка окружения (требуется npm/brew/uv), затем установка через нативный пакетный менеджер агента
   - **Ручная установка** — показывает точную команду и URL документации
4. **Обновление / Удаление агента** (если нажали `u`/`d` на установленном агенте):
   - Диалог подтверждения (`Да`/`Нет`)
   - Выполнение команды (`npm update -g`, `brew upgrade`, `uv tool uninstall` и т.д.) с живым спиннером
   - При успехе → возврат к списку агентов с обновлённым статусом
   - При ошибке → показ stderr; возможность повторить или вернуться назад
5. **Запуск** — AgentO применяет конфиг агента и запускает его

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
| **Слияние конфигов агентов** | `true` / `false` | Сохранять неизвестные ключи при записи конфига агента (conservative merge) |

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
agento --dev    # Показать development-агентов в TUI
```

### `agento launch` — Запуск агента

```bash
agento launch -p <profile> -a <agent> [options]

Опции:
  -p, --profile <name>   Имя профиля (обязательно)
  -a, --agent <id>       Агент: claude-code, opencode, qwen, codex (обязательно)
  -m, --mode <mode>      Режим запуска: child или independent (по умолчанию из настроек)
  -s, --scope <scope>    Область конфига: global или project (по умолчанию из настроек)
  -d, --dev              Показать development-агентов
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
- `anthropic-compatible`: использует стандартный endpoint Anthropic (`https://api.anthropic.com`)
- `fireworks`: автоматически `https://api.fireworks.ai/inference`, если не указан
- `openrouter`: автоматически `https://openrouter.ai/api/v1` (Claude Code: `https://openrouter.ai/api`), если не указан
- `openai-compatible`: автоматически `https://api.openai.com/v1`, если не указан; для нестандартных провайдеров указывайте явно через `-u`

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
agento agent status --dev                     # Включая development-агентов
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
    "mergeAgentConfigs": true
  }
}
```

> Конфиги, созданные AgentO < 0.2.0, имеют `models` как массив строк. Они мигрируются автоматически при чтении; возможности по умолчанию `{ image: true, video: false, audio: false }`, меняются в TUI.

## Как это работает

### Адаптеры агентов

Каждый поддерживаемый агент имеет адаптер, который переводит универсальный формат AgentO в специфичный конфиг агента:

- **Claude Code** (`anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible`): Генерирует `~/.claude/settings.json` с выбором модели по уровням и переменными окружения `ANTHROPIC_*`. Использует Anthropic SDK. Ключ API **не** попадает в файл — `apiKeyHelper` читает его из `AGENTO_ANTHROPIC_API_KEY`, которую AgentO прокидывает в окружение агента.
  - Для `fireworks` и `openrouter`: автоматически стартует локальный **Anthropic Scrubber proxy**, вырезающий неподдерживаемые поля из запросов.
  - Для `openai-compatible`: автоматически стартует локальный **OpenAI-to-Anthropic proxy**, транслирующий OpenAI API (включая SSE streaming) в Anthropic-формат.
  - Для `responses-compatible`: автоматически стартует локальный **Responses Proxy** (`src/proxy/responses-proxy.ts`), транслирующий Anthropic-запросы в формат OpenAI Responses API с поддержкой streaming.
  - Для `openrouter` использует **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer). Флаги возможностей не пробрасываются.
- **OpenCode** (`anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api`): Генерирует `~/.config/opencode/config.json` через Vercel AI SDK. Использует нативный `@ai-sdk/openai` для реальных OpenAI API (автоопределение по `baseUrl`). Полная поддержка function calling. Для каждой модели генерируется `modalities: { input: [...], output: ["text"] }` из флагов возможностей.
- **Qwen CLI** (`openai-compatible`, `fireworks`, `openrouter`): Генерирует `~/.qwen/settings.json` со структурой OpenAI-совместимого провайдера. Требует `baseUrl`. Пробрасывает флаги возможностей через `generationConfig.modalities`.
- **Codex CLI**: Генерирует `~/.codex/config.toml` с `wire_api: responses` и `model_providers`, а профиль (`model` + `model_provider`) записывает в отдельный `~/.codex/default.config.toml` (новый формат Codex CLI v0.134.0+). При project-области разделяет конфиг между глобальным и проектным. Поддерживает `openai-compatible`, `fireworks`, `openrouter`. Флаги возможностей не пробрасываются.
- **Copilot** (все 4 типа провайдеров): Не записывает и не изменяет файл настроек. Весь конфиг передаётся через `COPILOT_MODEL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BASE_URL`. Типы `fireworks` и `openrouter` отображаются как `COPILOT_PROVIDER_TYPE=openai`. Для моделей семейства gpt-5 автоматически добавляется `COPILOT_PROVIDER_WIRE_API=responses`.
- **Goose** (все типы провайдеров): Не изменяет файл настроек. Весь конфиг через `GOOSE_PROVIDER` + `GOOSE_MODEL` + ключи провайдера. `anthropic-compatible` → `ANTHROPIC_API_KEY`; `openrouter` → `OPENROUTER_API_KEY`; `fireworks`/`openai-compatible` → `OPENAI_API_KEY` + `OPENAI_HOST`. Суффикс `/v1` автоматически убирается из `OPENAI_HOST` (Goose сам дописывает `/v1/chat/completions`).

**Conservative Config Merge:** При `mergeAgentConfigs=true` (по умолчанию) адаптеры Claude Code, Qwen и OpenCode сохраняют неизвестные top-level ключи из существующего конфига. Перезаписываются только ключи, генерируемые AgentO. Вложенные объекты заменяются целиком, за исключением `env` — они мержатся flat (существующие переменные окружения, не управляемые AgentO, сохраняются). Copilot и Goose не затронуты (env-only, нет записи в файл). Codex использует собственную логику split-file merge и игнорирует этот флаг.

### Бэкап и восстановление

Перед изменением любого конфига агента AgentO создаёт v2 manifest-бэкап в `~/.agento/backups/<agent>/<scope>.bak.json`.

Если активный бэкап для того же agent/scope уже существует, запуск блокируется до `agento restore -a <agent> -s <scope>`. Это защищает original backup от перезаписи при повторных Independent-запусках.

В **режиме Child** оригинальный конфиг автоматически восстанавливается при выходе агента или получении SIGTERM/SIGINT.

В **режиме Independent** конфиг остаётся изменённым. Восстановите вручную через `agento restore`. Если файла конфига до запуска не было, restore удалит сгенерированный файл вместо записи пустого конфига.

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
