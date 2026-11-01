# AgentO — Менеджер конфигураций AI-агентов

[![npm version](https://img.shields.io/npm/v/%40emaxe%2Fagento)](https://www.npmjs.com/package/@emaxe/agento)
[![CI](https://github.com/emaxe/agentO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/emaxe/agentO/actions/workflows/ci.yml)
[![Changelog](https://img.shields.io/badge/changelog-0.14.0-blue)](CHANGELOG.md#0140---2026-11-01)
[![Node.js](https://img.shields.io/node/v/%40emaxe%2Fagento)](https://www.npmjs.com/package/@emaxe/agento)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue)](https://github.com/emaxe/agentO/blob/main/README.ru.md#установка)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Настройте один раз, запускайте повторно одной клавишей. Общие профили моделей и API-провайдеры для одиннадцати AI-агентов.

AgentO — это CLI-инструмент для централизованного управления конфигурациями популярных AI-агентов для программирования. Задайте API-провайдеры один раз, создайте профили с разными комбинациями моделей и переключайтесь между ними одной командой.

**English version:** [README.md](README.md)

## Поддерживаемые агенты

| Агент | Команда | Формат конфига | Поддерживаемые провайдеры | Особенности |
|-------|---------|----------------|---|-------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible` | Поддержка уровней (small/base/smart). Для не-Anthropic провайдеров используется локальный proxy. |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Полная поддержка function calling через Vercel AI SDK; пробрасывает модальности |
| [Qwen CLI](https://github.com/QwenLM/qwen-code) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Структура OpenAI-совместимого API; пробрасывает модальности |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `openai-compatible`, `responses-compatible`, `fireworks`, `openrouter`, `custom-api` | `wire_api: responses`. Профиль в отдельном `default.config.toml`. |
| [Kimi Code](https://www.kimi.com/code) | `kimi` | TOML | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Пишет `~/.kimi/config.toml` (`default_model`, `providers`, `models`); legacy `~/.kimi/config.json` тоже читается. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | `hermes` | YAML | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Пишет `model` и `providers` в `~/.hermes/config.yaml` (`%LOCALAPPDATA%\hermes` на Windows, `HERMES_HOME` приоритетнее). Toolsets/gateway/hooks сохраняются. Project-конфига нет: оба scope — один файл. |
| [Hermes Desktop](https://github.com/NousResearch/hermes-agent) | `hermes` | YAML | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Тот же конфиг, что у Hermes Agent; запускает `hermes desktop`. Первый запуск собирает Electron-приложение. |
| [Kilo Code](https://github.com/Kilo-Org/kilo-code) | `kilo` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Читает `defaultProvider`/`defaultModel` из `~/.kilocode/settings.json`. Кастомный `baseUrl` из `~/.kilocode/models.json`. |
| [PI](https://pi.dev/docs/getting-started/installation) | `pi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Читает `defaultProvider`/`defaultModel` из `~/.pi/agent/settings.json`. Кастомный `baseUrl` из `~/.pi/agent/models.json`. |
| [Copilot](https://github.com/github/copilot-cli) | `copilot` | только env-переменные | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Весь конфиг передаётся через переменные окружения — файл настроек не изменяется. |
| [Goose](https://goose-docs.ai) | `goose` | только env-переменные | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Весь конфиг через env vars (`GOOSE_PROVIDER`, `GOOSE_MODEL`). |

## Поддерживаемые типы провайдеров

| Тип провайдера | Совместимые агенты | Примеры |
|---|---|---|
| `openai-compatible` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi, hermes, hermes-desktop | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek и т. д. |
| `anthropic-compatible` | claude-code, opencode, copilot, goose, pi, kilo, kimi, hermes, hermes-desktop | Anthropic и любой endpoint с Anthropic Messages API |
| `fireworks` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi, hermes, hermes-desktop | Fireworks AI (поддерживает все 3 типа API) |
| `openrouter` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi, hermes, hermes-desktop | [OpenRouter](https://openrouter.ai) — универсальный шлюз (Anthropic Skin / OpenAI / Responses API) |
| `responses-compatible` | claude-code, opencode, codex, copilot, goose, kilo, kimi, hermes, hermes-desktop | OpenAI и любой провайдер, поддерживающий OpenAI Responses API |
| `custom-api` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi, hermes, hermes-desktop | Любой self-hosted endpoint или шлюз; протоколы задаются через `customApiModes` |

**Примечания:**
- `claude-code` работает со всеми 6 типами провайдеров. Для не-`anthropic-compatible` провайдеров используется локальный proxy: Anthropic Scrubber для `fireworks`/`openrouter`; OpenAI-to-Anthropic proxy для `openai-compatible`; Responses Proxy для `responses-compatible`. Для `openrouter` используется **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer).
- `copilot` и `goose` работают со всеми типами провайдеров; конфиг передаётся через переменные окружения, файл настроек не изменяется.
- `custom-api` — универсальный вариант для self-hosted endpoint или шлюза: задайте `baseUrl` и включите те протоколы, которые он реально поддерживает, через `customApiModes` (`openai`, `anthropic`, `responses`). Нужен хотя бы один режим. AgentO сам подставляет нужный суффикс: `/v1` для openai, ничего для anthropic (клиент сам добавляет `/v1/messages`), `/v1/responses` для responses.
- `qwen` и `codex` — единственные агенты, не поддерживающие `anthropic-compatible`; `qwen` и `pi` — единственные без `responses-compatible`.

## Ключи API и безопасность git

Ключи провайдеров хранятся в `~/.agento/config.json` (права `0700` на каталог, `0600` на файл). AgentO использует переменные окружения там, где это поддерживает адаптер; часть адаптеров также записывает ключи в конфиги агентов. Сгенерированные файлы и backup manifest могут содержать секреты. Launch Preview показывает реальные файлы и имена env-переменных, не раскрывая значения.

Важно понимать про **project scope**: в этом режиме адаптер выбирает проектные файлы; некоторые агенты, например Codex, также меняют глобальные настройки. Среди файлов *внутри репозитория* (`.claude/settings.json`, `.codex/config.toml`, …), а часть этих путей принято коммитить — например, Claude Code считает `.claude/settings.json` общим файлом команды и гитигнорит только `settings.local.json`.

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

- **Операционные системы:** macOS, Linux, Windows 10 (1809+) и Windows 11
- Node.js ≥ 18 (на Windows рекомендуются Node 20+ и [Windows Terminal](https://aka.ms/terminal))
- Один или несколько установленных CLI-инструментов поддерживаемых агентов (большинство AgentO умеет ставить сам)

Всё работает на всех трёх системах: TUI, `agento launch` (режимы child и independent),
`agento restore`, определение установленных агентов и мастер установки. Особенности
платформы — в разделе [Windows](#windows).

## Windows

```powershell
npm i -g @emaxe/agento
agento
```

Запускайте из PowerShell, Windows Terminal или `cmd.exe`. WSL тоже работает и идёт по Linux-пути.

- **Запуск агентов.** Установленные через npm CLI на Windows — это `.cmd`-шимы; AgentO находит их
  через `PATH`/`PATHEXT` и запускает корректно, в том числе из путей с пробелами и не-ASCII символами.
- **Установка агентов.** Из мастера установки в TUI: через npm, winget (Copilot) или uv (Kimi), где это
  поддержано. **Goose — только вручную**: `winget search goose` или загрузка с
  <https://github.com/block/goose/releases/latest>.
- **Расположение конфигов.** Агенты читают конфиг из `%USERPROFILE%` (Goose: `%APPDATA%\Block\goose\config`).
  Полная таблица — [docs/windows-support/config-paths.md](docs/windows-support/config-paths.md).

### Ограничения Windows

- Поддерживаются только лаунчеры `.cmd`/`.bat`/`.exe`. CLI, у которого **только** `.ps1`-шим, не работает
  при строгой ExecutionPolicy PowerShell (`Restricted`/`AllSigned`); AgentO политику не обходит.
- На Windows нет graceful `SIGTERM`. Ctrl+C или закрытие окна консоли завершают всё дерево процессов
  агента (`taskkill /T /F`), после чего исходный конфиг восстанавливается.
- При жёстком завершении (Диспетчер задач → «Снять задачу», отключение питания) выполнить код некому,
  поэтому конфиг восстанавливается при **следующем** запуске `agento`: устаревший бэкап, процесс которого
  уже не существует, восстанавливается автоматически.
- Ключи API хранятся открытым текстом в конфигах самих агентов, как на macOS/Linux; шифрования
  через DPAPI/Credential Manager нет.

### Решение проблем на Windows

- **Агент установлен, но AgentO пишет «not installed».** `PATH` терминала старше установки. Перезапустите
  терминал; AgentO также смотрит в `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`,
  `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin` и `%USERPROFILE%\.cargo\bin`.
- **`npm install -g` падает с `EPERM`/`EACCES`.** Укажите npm каталог, доступный на запись:
  `npm config set prefix %APPDATA%\npm`.
- **`ENAMETOOLONG` / пути длиннее 260 символов.** Включите длинные пути (`LongPathsEnabled=1` в
  `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`, затем перезагрузка) или используйте более короткий путь к проекту.
- **`Active backup already exists`.** Предыдущий запуск завершился нештатно. Выполните
  `agento restore -a <agent> -s <scope>` и запустите снова.

Подробности — что проверено, а что ещё требует ручной приёмки — в
[docs/windows-support/report.md](docs/windows-support/report.md).

## Быстрый старт

Для настройки через мастер запустите `agento` и выберите **Set up AgentO**: провайдер → модель → профиль → агент → сводка → запуск. Затем клавиша **r** повторяет последний подтверждённый запуск.

Ниже — тот же сценарий через CLI. Полный список изменений — в [релизе 0.14.0](CHANGELOG.md#0140---2026-11-01).

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
agento profile add -n "default" -m "my-provider:claude-sonnet-4-20250514"

# Многоуровневый профиль (требуются уровни: small/base/smart)
agento profile add -n "multi" -m "my-provider:claude-3-5-haiku-20241022:small,my-provider:claude-sonnet-4-20250514:base,my-provider:claude-opus-4-20250514:smart"
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

Первое действие — **Launch last** (**r**), если предыдущий запуск доступен, или **Set up AgentO**. Далее идут **New launch**, **Profiles**, **Providers**, **Agents & recovery**, **Settings**. Показаны текущий каталог, последний профиль, агент, основная модель, режим и scope.

**↑↓ / Enter** — выбор, **1–6** — переход к разделу, **?** — справка, **q / Esc** — выход. Уведомление об активных backups вынесено отдельно: **b** открывает восстановление на затронутом агенте. После child-запуска главное меню отдельно показывает результат агента и результат восстановления конфигурации, включая ошибку cleanup.

### Первый запуск

**Set up AgentO** проводит по одному маршруту:

**Provider → Model → Profile → Agent → Review → Launch**

Выберите сохранённого провайдера или подключите известный сервис/custom endpoint. **Load models** — необязательная загрузка каталога, она не проверяет генерацию. Если endpoint недоступен, повторите запрос или введите модель вручную в **Models**: введённые данные сохраняются после ошибки.

Подтвердите сохранение провайдера, выберите модель и примите предложенное имя профиля либо измените его. Для одной модели tier не спрашивается. Завершённые шаги остаются сохранёнными после выхода из мастера; подходящий сохранённый профиль можно использовать повторно. Если агент отсутствует, открывается мастер установки. Совместимость проверяется по тем же правилам, что и в CLI.

### Новый и повторный запуск

**New launch** предлагает профиль, затем агента. В списке профилей видны основная модель и провайдер. **/** ищет по именам, моделям и провайдерам; поддерживаются Unicode и вставленный текст. **m** меняет child/independent, **s** — global/project.

Установленные агенты идут первыми; выбор сохраняется при обновлении статусов. **i** раскрывает причины несовместимости, **e** открывает редактор профиля с возвратом к запуску. Установка отсутствующего агента остаётся здесь; обновление и удаление перенесены в **Agents & recovery**.

Новый или изменённый запуск автоматически открывает **Launch Preview**. **Enter** подтверждает сводку, **v** всегда открывает её вручную. Последний подтверждённый запуск с неизменными параметрами выполняется напрямую, в том числе клавишей **r** с главного экрана. Изменения профиля, модели, ключа, endpoint, режима, scope, каталога, merge или путей конфигурации требуют новой сводки. В кеше хранится только версионированный отпечаток, без ключей и сгенерированных конфигов.

В сводке перечислены модель, провайдер, каталог, реальные создаваемые/изменяемые файлы, имена env-переменных, backup и способ восстановления. **Project scope может затрагивать глобальные файлы** — например, у Codex. Для env-only агентов явно указано, что файлы не записываются. **↑↓ / PgUp/PgDn** прокручивают длинную сводку и справку, сохраняя доступ к действию запуска.

При ошибке подготовки: **r** — повторить, **a** — открыть recovery, **t** — технические подробности. Для backup выбранного scope предлагается **Restore previous config and launch** с файлами и известным состоянием сессии. Конфликт общих файлов открывает scope и каталог владельца backup; ограничения transaction layer сохраняются.

В **child mode** конфигурация восстанавливается после выхода агента, затем открывается главное меню. В **independent mode** AgentO завершается, а изменённая конфигурация остаётся до восстановления.

### Формы и клавиатура

**Tab / Shift+Tab** меняют поле. **Esc** отменяет текущую правку имени модели, возвращает на предыдущий шаг или спрашивает перед выходом из изменённой формы. По умолчанию выбрано **Keep editing**; для выхода выберите **Discard changes**. Формы показывают состояния saving/saved/error, блокируют повторную запись и сохраняют данные для повторной попытки после ошибки. API-ключ скрыт по умолчанию; **Ctrl+R** раскрывает/скрывает его в форме провайдера.

Списки учитывают высоту терминала, сохраняют выбранный элемент по ID и ограничивают раскрытые детали. Маркер **[iva]** означает image/video/audio, дефис — отключённую возможность. Роли нескольких моделей: **small** — быстрые задачи, **base** — повседневная работа, **smart** — сложные задачи.

### Экран провайдеров

Управляйте API-провайдерами без необходимости запоминать CLI-флаги:

- **Просмотр** всех провайдеров с типом, моделями, маркерами возможностей и base URL
- **Добавление** нового провайдера с подсказками (имя, тип, API-ключ, модели, base URL)
- **Редактирование** существующих провайдеров — включая флаги возможностей моделей (`i`/`v`/`a`). Модели можно править вручную; **Load models** и **Choose loaded models** — необязательные помощники
- **Загрузка каталога моделей** по `t`; число моделей или ошибка видны под выделенной строкой, генерация не проверяется
- **Дублирование** по `c` — удобно для второго ключа или base URL; копия получает следующее свободное имя
- **Фильтр** по `/` — по имени, типу, base URL или имени модели
- **Удаление** ненужных провайдеров. Провайдера, на который ссылается профиль, удалить нельзя: экран перечислит мешающие профили

В режиме редактирования модели отображаются как `▶ [i--] model-name`. Когда выделена модель, нажимайте `i` / `v` / `a`, чтобы переключать image / video / audio. Используйте строку `[+ add model]` (Enter) для добавления моделей, `d` — удалить, `e` — переименовать. API-ключи скрыты в списке и форме; **Ctrl+R** раскрывает/скрывает значение в форме.

### Экран профилей

Организуйте конфигурации моделей:

- **Просмотр** всех профилей с моделями и уровнями
- **Добавление** профилей с одной или несколькими моделями. Уже занятые tier'ы скрыты; в многоуровневом профиле обязателен один `base`. Если у единственной модели нет tier, при добавлении второй мастер сначала попросит его назначить
- **Фильтр** по `/` — по имени профиля, модели или провайдеру
- **В деталях профиля:** добавление/удаление/редактирование отдельных моделей

### Agents & recovery

Следите за статусом конфигураций агентов:

- Увидеть, есть ли у каждого агента **глобальный** или **проектный** конфиг
- Проверить, есть ли **бэкапы** (признак того, что AgentO ранее изменял конфиг)
- Посмотреть пути к конфигам для каждого агента
- Нажать **/**, чтобы фильтровать по имени, области или пути; **f** — только изменённые
- Нажать **r**, чтобы восстановить изменённый конфиг. AgentO сначала спросит подтверждение (`y/Enter: restore`, `n/Esc: cancel`), потому что восстановление заменяет текущий файл и удаляет бэкап

**i / u / d** открывают установку / обновление / удаление выбранного агента. Перед восстановлением показаны файлы manifest и известное состояние сессии; ошибка остаётся в диалоге.

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
agento --dev    # Устарело: все агенты показываются всегда; флаг оставлен для совместимости
```

### `agento launch` — Запуск агента

```bash
agento launch [-p <profile>] [-a <agent>] [options]

Опции:
  -p, --profile <name>   Имя или id профиля (по умолчанию — последний запуск)
  -a, --agent <id>       id или имя агента (по умолчанию — последний запуск):
                         claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi,
                         hermes, hermes-desktop
  -m, --mode <mode>      Режим: child или independent (последний запуск, затем настройки)
  -s, --scope <scope>    Область: global или project (последний запуск, затем настройки)
  -d, --dev              Устарело: все агенты показываются всегда; флаг оставлен для совместимости
  --dry-run              Показать, что будет изменено, ничего не записывая
```

Если `-p`/`-a` не указаны, используется последний запуск; если его нет —
запустите `agento` для интерактивного выбора. Имена профилей и агентов
регистронезависимы, уникальный префикс принимается (`-p wor -a clau`).
`--dry-run` показывает файлы, имена env-переменных, состояние бэкапа и
предупреждения, ничего не записывая.

**Режимы запуска:**

- **Child** (по умолчанию): Временно заменяет конфиг агента, запускает его, восстанавливает оригинальный конфиг при выходе
- **Independent**: Постоянно заменяет конфиг; восстановление вручную

**Области конфига:**

- **Global**: `~/.<agent>/settings.*`
- **Project**: `./.<agent>/settings.*` или `./<agent>.*`

### `agento provider` — Управление провайдерами

```bash
agento provider list [--json]                 # Список провайдеров (ключи замаскированы)
agento provider add [options]                 # Добавить провайдер
  -n, --name <name>         Отображаемое имя (обязательно)
  -t, --type <type>         Тип: openai-compatible, anthropic-compatible, fireworks, openrouter, responses-compatible, custom-api (обязательно)
  -k, --api-key <key>       API-ключ (обязательно)
  -u, --base-url <url>      Base URL (обязателен для responses-compatible/custom-api, опционален для остальных)
  -c, --custom-api-modes <json>  JSON-флаги {openai,anthropic,responses} (обязательно для custom-api)
  -M, --models <models>     Список моделей через запятую
  --fetch-models            Получить модели из /models провайдера вместо -M
agento provider edit <name> [options]         # Изменить имя/тип/ключ/baseUrl/модели (те же флаги, все опциональны)
agento provider test <name> [--json]          # Проверить /models
agento provider remove <name>                 # Удалить провайдер (запрещено, пока его использует профиль)
```

**Дефолты Base URL:**
- `anthropic-compatible`: использует стандартный endpoint Anthropic (`https://api.anthropic.com`)
- `fireworks`: автоматически `https://api.fireworks.ai/inference`, если не указан
- `openrouter`: автоматически `https://openrouter.ai/api/v1` (Claude Code: `https://openrouter.ai/api`), если не указан
- `openai-compatible`: автоматически `https://api.openai.com/v1`, если не указан; для нестандартных провайдеров указывайте явно через `-u`

### `agento profile` — Управление профилями

```bash
agento profile list [--json]                   # Список всех профилей
agento profile add [options]                  # Добавить профиль
  -n, --name <name>         Имя профиля (обязательно)
  -m, --models <models>     Список provider:modelName[:tier] через запятую (обязательно)
                            provider — имя провайдера (без учёта регистра) или UUID
                            Tier опционален для одномодельных профилей.
                            Для многоуровневых: tier должен быть small|base|smart, минимум один base.
agento profile remove <name>                  # Удалить профиль
```

### `agento agent` — Статус агентов

```bash
agento agent status [--json]                  # Статус конфигов + версия установленных агентов
agento agent status --dev                     # Устарело: все агенты показываются всегда
```

### `agento restore` — Восстановление конфига

```bash
agento restore [-a <agent>] [-s <scope>]      # Восстановить конфиг агента из бэкапа
agento restore --list                        # Список активных бэкапов для текущего каталога

Опции:
  -a, --agent <id>         id или имя агента (выводится, если активен ровно один бэкап)
  -s, --scope <scope>      Область: global или project (выводится из активных бэкапов)
  -l, --list               Показать активные бэкапы, ничего не восстанавливая
```

### `agento config` — Пути конфигурации

```bash
agento config path [--json]                   # Пути к config, ui-state и backups
```

### `agento doctor` — Диагностика

```bash
agento doctor [--json]                        # Версии, состояние конфига, активные бэкапы, установленные агенты
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

### UI state

Последний запуск (профиль/агент/режим/область) кешируется в `~/.agento/ui-state.json`.
Также хранится версионированный отпечаток подтверждённых параметров и каталога, без ключей и сгенерированного конфига. Удаление файла сбрасывает предвыбор и требует новой сводки. Битый файл или устаревшее подтверждение игнорируются. `agento config path` печатает этот путь,
путь к конфигу и каталог бэкапов.

## Как это работает

### Адаптеры агентов

Каждый поддерживаемый агент имеет адаптер, который переводит универсальный формат AgentO в специфичный конфиг агента:

- **Claude Code** (`anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible`): Генерирует `~/.claude/settings.json` с выбором модели по уровням и переменными окружения `ANTHROPIC_*`. Использует Anthropic SDK. Ключ API **не** попадает в файл — `apiKeyHelper` читает его из `AGENTO_ANTHROPIC_API_KEY`, которую AgentO прокидывает в окружение агента.
  - Для `fireworks` и `openrouter`: автоматически стартует локальный **Anthropic Scrubber proxy**, вырезающий неподдерживаемые поля из запросов.
  - Для `openai-compatible`: автоматически стартует локальный **OpenAI-to-Anthropic proxy**, транслирующий OpenAI API (включая SSE streaming) в Anthropic-формат.
  - Для `responses-compatible`: автоматически стартует локальный **Responses Proxy** (`src/proxy/responses-proxy.ts`), транслирующий Anthropic-запросы в формат OpenAI Responses API с поддержкой streaming.
  - Для `openrouter` использует **Anthropic Skin** — `ANTHROPIC_AUTH_TOKEN` (Bearer). Флаги возможностей не пробрасываются.
- **OpenCode** (`anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api`): Генерирует `~/.config/opencode/config.json` через Vercel AI SDK. Использует нативный `@ai-sdk/openai` для реальных OpenAI API (автоопределение по `baseUrl`). Полная поддержка function calling. Для каждой модели генерируется `modalities: { input: [...], output: ["text"] }` из флагов возможностей.
- **Qwen CLI** (`openai-compatible`, `fireworks`, `openrouter`, `custom-api`): Генерирует `~/.qwen/settings.json` со структурой OpenAI-совместимого провайдера и пробрасывает флаги возможностей через `generationConfig.modalities`. При запуске OpenAI o-series, gpt-5 и новее, а также неизвестные модели на `api.openai.com` проходят через локальный proxy, заменяющий `max_tokens` на `max_completion_tokens`; известные старые модели, например gpt-4, остаются на прямом соединении. Другие шлюзы тоже остаются прямыми, если имя модели не относится к проксируемому семейству. Для gpt-6 и новее при использовании tools proxy выставляет `reasoning_effort: "none"`; reasoning-only семейства, которые это значение отвергают (`gpt-6.1-sol`, `gpt-6-astra`), один раз переигрываются через `/v1/responses` с переводом обратно в Chat Completions, поэтому function tools продолжают работать. При cleanup proxy останавливается.
- **Codex CLI**: Генерирует `~/.codex/config.toml` с `wire_api: responses` и `model_providers`, а профиль (`model` + `model_provider`) записывает в отдельный `~/.codex/default.config.toml` (новый формат Codex CLI v0.134.0+). При project-области разделяет конфиг между глобальным и проектным. Поддерживает `openai-compatible`, `fireworks`, `openrouter`. Флаги возможностей не пробрасываются.
- **Copilot** (все типы провайдеров): Не записывает и не изменяет файл настроек. Весь конфиг передаётся через `COPILOT_MODEL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BASE_URL`. Типы `fireworks` и `openrouter` отображаются как `COPILOT_PROVIDER_TYPE=openai`. Для моделей семейства gpt-5 автоматически добавляется `COPILOT_PROVIDER_WIRE_API=responses`.
- **Goose** (все типы провайдеров): Не изменяет файл настроек. Весь конфиг через `GOOSE_PROVIDER` + `GOOSE_MODEL` + ключи провайдера. `anthropic-compatible` → `ANTHROPIC_API_KEY`; `openrouter` → `OPENROUTER_API_KEY`; `fireworks`/`openai-compatible` → `OPENAI_API_KEY` + `OPENAI_HOST`. Суффикс `/v1` автоматически убирается из `OPENAI_HOST` (Goose сам дописывает `/v1/chat/completions`).

**Conservative Config Merge:** При `mergeAgentConfigs=true` (по умолчанию) адаптеры Claude Code, Qwen и OpenCode сохраняют неизвестные top-level ключи из существующего конфига. Перезаписываются только ключи, генерируемые AgentO. Вложенные объекты заменяются целиком, за исключением `env` — они мержатся flat (существующие переменные окружения, не управляемые AgentO, сохраняются). Copilot и Goose не затронуты (env-only, нет записи в файл). Codex использует собственную логику split-file merge и игнорирует этот флаг.

### Бэкап и восстановление

Перед изменением любого конфига агента AgentO создаёт v2 manifest-бэкап в `~/.agento/backups/<agent>/<scope>.bak.json`.

Если активный бэкап для того же agent/scope уже существует, запуск блокируется до `agento restore -a <agent> -s <scope>`. Это защищает исходный backup от перезаписи при повторных Independent-запусках. Активные manifest также резервируют физические файлы между разными scope и каталогами. Подготовка и восстановление сериализуются между процессами; cleanup старой сессии не может восстановить более новую. Ошибка пересечения указывает backup и каталог владельца.

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

### Начните с `agento doctor`

```bash
agento doctor          # версии, состояние конфига, активные бэкапы, установленные агенты
agento config path     # где лежат config.json, ui-state.json и backups
```

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
