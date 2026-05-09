# AgentO — Менеджер конфигураций AI-агентов

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Управляйте конфигурациями AI-агентов с помощью профилей и провайдеров. Переключайтесь между моделями, провайдерами и агентами без лишних усилий.

AgentO — это CLI-инструмент для централизованного управления конфигурациями популярных AI-агентов для программирования. Задайте API-провайдеры один раз, создайте профили с разными комбинациями моделей и переключайтесь между ними одной командой.

**English version:** [README.md](README.md)

## Поддерживаемые агенты

| Агент | Команда | Формат конфига | Особенности |
|-------|---------|----------------|-------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | Поддержка уровней (small/base/smart) |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | Префикс провайдера |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | OpenAI-совместимые провайдеры |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | Инжект переменных окружения. Скрыт по умолчанию (флаг `--dev`). |

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
┌────────── AgentO v0.1.1 ──────────┐
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
| **Запуск агента** | Выбор профиля → агента → режима/области → запуск | **Enter** выбор, **Esc** назад |
| **Провайдеры** | Просмотр, добавление, редактирование, удаление API-провайдеров | **Enter** детали, **a** добавить, **e** редактировать, **d** удалить, **Esc** назад |
| **Профили** | Просмотр, добавление, удаление профилей. В деталях: добавление/удаление/редактирование моделей | **Enter** детали, **a** добавить, **d** удалить, **Esc** назад |
| **Агенты** | Проверка статуса конфигов (global/project), наличие бэкапов | **Enter** детали, **Esc** назад |
| **Настройки** | Изменение режима запуска, области конфига, режима independent | **↑↓** изменение, **Enter** переключение, **Esc** сохранить и назад |

### Сценарий запуска агента

1. **Выбор профиля** — выберите один из сохранённых профилей
2. **Выбор агента** — выберите агента для запуска (claude-code, opencode, qwen или codex с `--dev`)
3. **Опционально:** настройте **Режим** (child/independent) и **Область** (global/project)
4. **Запуск** — AgentO заменяет конфиг агента и запускает его

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

- **Просмотр** всех провайдеров с типом, количеством моделей и base URL
- **Добавление** нового провайдера с подсказками (имя, тип, API-ключ, модели, base URL)
- **Редактирование** существующих провайдеров
- **Удаление** ненужных провайдеров

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
| **Режим independent** | `spawn-detached` / `pty` | Как запускать агентов в режиме independent |

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
agento provider list                          # Список всех провайдеров
agento provider add [options]                 # Добавить провайдер
  -n, --name <name>         Отображаемое имя (обязательно)
  -t, --type <type>         Тип: openai-compatible или anthropic (обязательно)
  -k, --api-key <key>       API-ключ (обязательно)
  -u, --base-url <url>      Base URL (для openai-compatible)
  -M, --models <models>     Список моделей через запятую (обязательно)
agento provider remove <name>                 # Удалить провайдер
```

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
      "type": "openai-compatible",
      "apiKey": "sk-...",
      "baseUrl": "https://api.fireworks.ai/inference/v1",
      "models": ["accounts/fireworks/models/llama-v3p1-70b-instruct"]
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

## Как это работает

### Адаптеры агентов

Каждый поддерживаемый агент имеет адаптер, который переводит универсальный формат AgentO в специфичный конфиг агента:

- **Claude Code**: Генерирует `~/.claude/settings.json` с выбором модели по уровням
- **OpenCode**: Генерирует `~/.config/opencode/config.json` с префиксом провайдера
- **Qwen CLI**: Генерирует `~/.qwen/settings.json` со структурой OpenAI-совместимого провайдера
- **Codex CLI** (`--dev` для отображения): Генерирует `~/.codex/config.toml` с `wire_api: responses`, профилями и ссылками на переменные окружения. При project-области разделяет конфиг между глобальным (`model_providers`) и проектным (`model`) конфигами.

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
