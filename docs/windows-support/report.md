# Поддержка Windows: итоговый отчёт

Статус на 2026-10-18, ветка `feature/windows-support`. План — `plan.md`, пути конфигов агентов —
`config-paths.md`, журналы стадий — `runs/` (локально, в git не попадает).

Принцип отчёта: здесь только то, что подтверждено автоматически (CI или тесты), и честная пометка
**«не проверено»** для всего остального. Результаты ручной приёмки на реальной Windows не выдуманы:
ни один пункт ручного чек-листа ниже ещё не пройден.

## 1. Что поддерживается

| | |
|---|---|
| ОС | Windows 10 1809+ и Windows 11; macOS и Linux — без изменений |
| Node.js | ≥ 18 по `engines`; на Windows тесты и CI — Node 20 и 22 (vitest 4 требует Node ≥ 20.12, поэтому Windows × Node 18 исключён из матрицы CI) |
| Терминалы | Windows Terminal и conhost; PowerShell и cmd. Рамки TUI в conhost деградируют до ASCII (`+---+`) |
| Работает | TUI, `agento launch` (child и independent), `agento restore`, определение установленных агентов и версий, мастер установки, локальные прокси, восстановление конфига при Ctrl+C / Ctrl+Break / закрытии окна и отложенное — после hard-kill |
| Альтернатива | WSL — это Linux-путь, работал и раньше |

## 2. Что проверено автоматически

Проверено в CI (`.github/workflows/ci.yml`, блокирующий job):

- `ubuntu-latest`, `macos-latest` × Node 18/20/22 и `windows-latest` × Node 20/22: lint, typecheck, тесты
  (Node ≥ 20), сборка, `node dist/bin/agento.js --version`.
- Тесты, которые реально исполняются только на Windows (`*.windows.test.ts`):
  - `spawn.windows.test.ts` — настоящий `.cmd`-шим в каталоге с пробелом, буквальная передача аргументов,
    сохранение кода выхода, `ENOENT` для несуществующей команды;
  - `kill-tree.windows.test.ts` — реальный `taskkill /T /F` убивает дерево процессов.
- Шаги ручной нативной оболочки в CI (добавлены в Stage F):
  - `pwsh`: `node dist\bin\agento.js --version` и `agent status`;
  - `cmd`: `npm pack` → глобальная установка tgz → `agento --version` (проверяет именно `.cmd`-шим npm).
- При падении тестов выгружается артефакт `junit-<os>-node<версия>` с `reports/junit.xml`.

На Linux (локально): 885 passed / 4 skipped / 889 всего, typecheck, lint и build зелёные, `--version` → 0.9.0.

> Оговорка. Зелёный Windows-CI подтверждён для состояния до Stage F. Изменения Stage F в самом workflow
> (убран `continue-on-error`, матрица, pwsh/cmd-шаги, junit-артефакт) локально проверены только
> синтаксисом YAML и командой vitest; **на GitHub Actions они ещё не запускались**. Первый прогон может
> потребовать правок (прежде всего — шаг `cmd` с глобальной установкой).

## 3. Проверено только юнит-тестами (нужна ручная приёмка)

Тесты используют фейковый `ChildProcess`, мок `killTree` и мок `fs`, в реальной Windows это не исполнялось:

- Реальное поведение Ctrl+C / Ctrl+Break / закрытия окна (SIGINT / SIGBREAK / SIGHUP). Допущение плана «агент
  получает тот же `CTRL_C_EVENT` через общую консоль» не подтверждено; поведение «Terminate batch job (Y/N)?» (V4) не проверено.
- Восстановление после hard-kill (Task Manager, BSOD): логика мёртвого pid проверена на сгенерированных манифестах;
  `process.kill(pid, 0)` как проверка существования на Windows (V6) — по документации Node.
- Ретраи `rename`/`unlink` на `EPERM/EBUSY` — на моке; настоящий антивирус/индексатор не воспроизводился.
- Win32-ключ бэкапа (регистр, зарезервированные имена, длинные пути) — вызывается с `platform='win32'` на Linux.
- Win32-ветки `shell-path-resolver`, `probeVersion`, `buildLaunchEnv`, инсталлеров — моки и инъекция `platform`.
- Потеря первого символа stdin при передаче терминала агенту (V7): внесена защитная мера (`setRawMode(false)`),
  эффект не проверен. Вставка с `\r\n` (V8) покрыта юнит-тестом санитайзера, поведение Ink в Windows Terminal — нет.
- Ширина/вид рамок в conhost и определение терминала по `WT_SESSION` / `TERM_PROGRAM`.

## 4. Агенты: установка на Windows

| Агент | Канал установки | Авто / вручную | Статус |
|---|---|---|---|
| claude-code | npm `@anthropic-ai/claude-code` | авто | не проверено на реальной Windows; общий npm-путь покрыт тестами с моками |
| opencode | npm `opencode-ai` | авто | то же; имя пакета исправлено (раньше `opencode` — 404, баг на всех ОС) |
| qwen | npm `@qwen-code/qwen-code@latest` | авто | не проверено на реальной Windows |
| codex | npm `@openai/codex` | авто | не проверено на реальной Windows (`dev: true`, скрыт без `--dev`) |
| kilo | npm `@kilocode/cli` | авто | не проверено на реальной Windows |
| pi | npm `@earendil-works/pi-coding-agent` | авто | не проверено на реальной Windows |
| copilot | winget `GitHub.Copilot`, иначе npm `@github/copilot` | авто | id winget и поведение PATH не подтверждены; канал выбирается при каждом вызове заново — update/uninstall могут выбрать другой канал, чем install |
| goose | — | **только вручную** (`winget search goose`, <https://github.com/block/goose/releases/latest>) | верифицированного канала нет |
| kimi | `uv tool install --python 3.13 kimi-cli`; без `uv` — вручную (`pip install kimi-cli`) | авто при наличии `uv` | не запускалось на Windows; неясно, ставится ли `~/.kimi` или `~/.kimi-code` (см. §5) |

`bash`/`curl`/`brew` на win32 не вызываются никогда. При `EPERM/EACCES` npm-инсталлеры подсказывают
`npm config set prefix %APPDATA%\npm`.

## 5. Пути конфигов и известные расхождения

Полная таблица с источниками и статусами — `config-paths.md`. Итог:

- Подтверждено документацией: claude-code (`%USERPROFILE%\.claude`), copilot (`~\.copilot`), goose
  (`%APPDATA%\Block\goose\config\config.yaml`), kilo (каталог `%USERPROFILE%\.config\kilo`), каталог opencode
  (`%USERPROFILE%\.config\opencode`), `~\.qwen`, `~\.codex`.
- Исправлено в коде: goose (win32-путь), codex (`CODEX_HOME`, иначе `homedir()`).
- **Расхождения без правки** (затрагивали бы POSIX или не подтверждены):
  - kilo: код пишет `~/.config/kilocode/config.json` и `kilocode.json`, документация — `~/.config/kilo/kilo.jsonc` и
    `kilo.jsonc`; запись AgentO, вероятно, вообще не читается — на всех ОС;
  - pi: у проектного `.pi/settings.json` по документации есть смысл, код направляет оба scope в глобальный файл;
  - opencode: код использует `config.json`, документация называет `opencode.json[c]` (читается ли legacy-имя — неизвестно);
  - kimi: две версии документации (`~/.kimi` + `KIMI_SHARE_DIR` и `~/.kimi-code` + `KIMI_CODE_HOME`);
  - goose project-путь `.goose/config.yaml` в документации не описан.
- Ни один адаптер не учитывает env-override (`CLAUDE_CONFIG_DIR`, `COPILOT_HOME`, `QWEN_HOME`,
  `PI_CODING_AGENT_DIR`, `GOOSE_PATH_ROOT`, `KIMI_SHARE_DIR` / `KIMI_CODE_HOME`, `OPENCODE_CONFIG_DIR`,
  `XDG_CONFIG_HOME`); `CODEX_HOME` учтён.

## 6. Известные ограничения

- **Goose** — только ручная установка.
- **`.ps1`-шимы и ExecutionPolicy.** Поддерживаются `.exe`/`.com`/`.cmd`/`.bat`; CLI с единственным `.ps1`-шимом
  при `Restricted`/`AllSigned` не запустится, политика не обходится.
- **Нет graceful SIGTERM.** Ctrl+C / закрытие окна завершают дерево принудительно (`taskkill /T /F`).
- **Отложенное восстановление после hard-kill.** Выполняется при следующем запуске, если процесс из манифеста
  мёртв; бэкапы, созданные до обновления (без `pid`), по-прежнему требуют `agento restore`.
- **Ключи не шифруются** (DPAPI / Credential Manager не используются): агенты читают plaintext сами; `mode 0o600` на
  Windows — no-op.
- **Длинные пути > 260:** `\\?\` не добавляется; при `ENAMETOOLONG` нужен `LongPathsEnabled`.
- **Дефект вне границ Stage F (код не правился):** `agento launch -m independent` завершает процесс через
  `process.exit(0)` и не пробрасывает код выхода агента; `cwd` в `spawnCommandSync` не передаётся (`src/cli/commands/launch.ts`,
  ветка independent). План (§3.2) предполагал исправление; в CHANGELOG об этом сознательно ничего не заявлено.
- Незапланированное в Stage D: win32-`cleanup` запускается по `exit` агента, жёсткого таймаута на cleanup нет.

## 7. Ручной чек-лист приёмки (план §8)

Окружения: **A** — Windows 11 + Windows Terminal (PowerShell 7); **B** — Windows 10 + conhost (cmd);
профиль пользователя с пробелом и кириллицей. Все пункты — **не проверено**.

| # | Пункт | A: WT + pwsh | B: conhost + cmd |
|---|---|---|---|
| 1 | `npm i -g @emaxe/agento` → `agento --version` | не проверено (в CI покрыт `windows-latest`) | не проверено (в CI покрыт `cmd` + `.cmd`-шим) |
| 2 | TUI: стрелки / Enter / Esc / `q`, ЙЦУКЕН (`й`=q, `Н`=y, `Т`=n), resize, рамки, вставка ключа с `\r\n` | не проверено | не проверено |
| 3 | Провайдер/профиль: добавить, `agento provider list` | не проверено | не проверено |
| 4 | `agento launch -p P -a claude-code` (child): старт, Ctrl+C в агенте, выход → конфиг восстановлен, бэкап удалён | не проверено | не проверено |
| 5 | Закрыть окно консоли во время агента → следующий запуск восстановил конфиг | не проверено | не проверено |
| 6 | Task Manager → End task → следующий запуск восстановил конфиг | не проверено | не проверено |
| 7 | Independent: проброс кода возврата (см. дефект в §6); `agento restore -a claude-code -s global` | не проверено | не проверено |
| 8 | Project-scope на `D:\` с пробелом: конфиг записан, `.git/info/exclude` обновлён, `git status` чист | не проверено | не проверено |
| 9 | Каждый из 9 агентов: статус/версия; автоустановка там, где заявлена; manual для goose | не проверено | не проверено |
| 10 | Прокси: claude с openai-compatible провайдером; брандмауэр молчит; порт освобождён | не проверено | не проверено |
| 11 | Путь > 260: понятная ошибка или работа при `LongPathsEnabled` | не проверено | не проверено |
| 12 | Потеря первого символа stdin после старта агента (V7), 5–10 повторов | не проверено | не проверено |
| 13 | Без TTY: `agento < NUL`, `agento \| more` → код 2 (`echo %errorlevel%`) | не проверено | не проверено |

## 8. Что осталось на будущее

- ConPTY-e2e: сквозные тесты TUI на реальной консоли Windows.
- ACL (`icacls`) для `~/.agento/**` и DPAPI / Credential Manager для ключей.
- Env-override каталогов конфигов (`GOOSE_PATH_ROOT`, `CLAUDE_CONFIG_DIR`, `COPILOT_HOME`, `QWEN_HOME` и др.) и
  чтение переменных PATH из реестра после установки агента.
- Исправление независимого запуска (код выхода, `cwd`), расхождений kilo / pi / opencode (см. §5).
- Подтверждение winget-id Copilot / Goose, выбор между `kimi` `~/.kimi` и `~/.kimi-code`.
- Обязательные проверки в ветке `main`: включение required checks — действие владельца репозитория (см.
  `runs/stageF-report.md`).
