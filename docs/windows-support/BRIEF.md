# Задача: план полной поддержки Windows для AgentO

## Контекст

Репозиторий: `~/projects/personal/agentO` (клон `git@github.com:emaxe/agentO.git`, ветка `main`, HEAD `423b00f`, версия 0.9.0).
Это CLI/TUI на TypeScript (Node >= 18, ESM, Ink/React, Commander, Zod) для управления конфигами AI-агентов: профили, провайдеры, запуск claude/opencode/qwen/codex/copilot/goose/pi/kilo/kimi через адаптеры.

Сейчас Windows официально не поддерживается: README прямо говорит «Windows is not supported today». Нужен **план доработки**, а не реализация.

## Уже установленные факты (не перепроверяй с нуля, но можешь уточнить по коду)

1. Все запуски идут с `shell: false`: `bin/agento.ts:41`, `src/launcher/child.ts:55`, `src/cli/commands/launch.ts:125`, инсталлеры `src/installers/npm.ts:55,83,111`, `copilot.ts:56`, `goose.ts:56`, `kimi.ts:62,90`.
2. В реестре `src/agents/registry.ts` команды заданы без расширения: `claude`, `opencode`, `qwen`, `codex`, `copilot`, `goose`, `pi`, `kilo`, `kimi`.
3. npm на Windows ставит `.cmd`/`.ps1`/bash-шимы. libuv при поиске в PATH пробует только `.com` и `.exe` (см. `src/win/process.c`, комментарий «CreateProcess can start only .com and .exe files»), `CreateProcess` не запускает `.cmd` без `cmd.exe`. Итог: `spawn('claude')` → ENOENT, `spawn('npm')` → ENOENT, `checkInstalled` всегда «not installed».
4. CI: job `windows-latest / node 20` падает на шаге Test, но помечен `continue-on-error: true` (`ci.yml:23-31`), поэтому общий прогон зелёный. Падают 10 тестов, в основном из-за POSIX-ожиданий путей (`/my/project/.claude/settings.json` против `\my\project\...`) и POSIX-сценариев `shell-path-resolver` на win32-хосте.
5. `src/launcher/shell-path-resolver.ts` уже имеет win32-ветку (разделитель `;`, без login-shell, `Path`/`PATH`) — это надо не сломать, а покрыть тестами.
6. `src/config/atomic-write.ts` использует `mode 0o600` — на Windows no-op, ACL не ограничивается.
7. `.gitignore` игнорирует `docs/*` (кроме `docs/backlog/**` и `docs/superpowers/**`). Именно поэтому `docs/windows-cross-platform-report.md`, на который ссылаются README и ci.yml, отсутствует в репозитории — файл не был закоммичен.
8. TUI: Ink 4, raw mode, маппинг ЙЦУКЕН→QWERTY (`src/tui/use-key-input.ts`), guard-тест на кириллицу в UI.

## Что нужно от тебя

Подготовь **подробный план доведения AgentO до полной поддержки Windows**. Только план — **не меняй исходный код**, не запускай миграции, не коммить. Единственный файл, который ты создаёшь, — свой plan-файл (путь ниже).

План должен быть практичным: его будет исполнять другой агент по шагам.

**Рабочее дерево общее с другим агентом:** не запускай `npm ci`/`npm install`/`npm test`/`npm run build` — это может испортить `node_modules` параллельному прогону. Разрешён только статический анализ (чтение файлов, grep, `git log`, `gh run view`).

### Обязательно покрыть

1. **Запуск агентов.** Резолвинг `.cmd`/`.bat`/`.ps1`-шимов: сравнить варианты (cross-spawn, `shell: true` только для win32, собственный резолвер с PATHEXT + `cmd.exe /d /s /c`), выбрать один и обосновать. Учесть пробелы и кавычки в путях, `windowsHide`, `COMSPEC`, аргументы с пробелами, `.ps1` и policy ExecutionPolicy, `npm`/`pnpm`/`yarn`-шимы.
2. **Определение установленности** (`checkInstalled` во всех инсталлерах) и **установка** (winget/scoop/npm/uv/manual fallback вместо brew/bash+curl). Для каждого из 9 агентов — что делать на Windows или честное «только ручная установка».
3. **PATH и окружение.** Существующая win32-ветка, PATHEXT, `Path` vs `PATH`, регистр имён переменных, `HOME` vs `USERPROFILE` (`src/adapters/codex.ts:59,86` использует `process.env.HOME ?? homedir()`), слияние env при запуске.
4. **Сигналы и cleanup.** На Windows нет SIGTERM; Ctrl+C, закрытие окна, kill дерева процессов (`taskkill /T /F`), гарантированное восстановление конфига (backup/restore) при любом исходе, `child.kill()` и таймауты.
5. **Файловая система.** Атомарная запись и rename поверх существующего файла, `chmod`-no-op и защита API-ключей на Windows (ACL/DPAPI — оценить целесообразность), пути project-scope, `.git/info/exclude` (сейчас нормализует слэши — проверить), длинные пути >260 символов, кириллица/Unicode в путях и локаль консоли (cp1251/cp866 vs UTF-8).
6. **TUI.** Ink/React на Windows Terminal и conhost, raw mode/stdin pause, клавиши Ctrl/Alt, стрелки, вставка, ресайз, отображение кириллицы и рамок, поведение при отсутствии TTY (CI).
7. **Локальный proxy** (`anthropic-scrubber`/`openai-proxy`/`responses-proxy`): биндинг 127.0.0.1, случайный порт, завершение, работа через Windows Firewall/antivirus — оценить риски.
8. **Тесты.** Как сделать тесты платформо-независимыми (инъекция платформы, `path.win32`/`path.posix`, фикстуры путей), какие новые тесты нужны (резолвер шимов, cleanup на Windows, installers), как не потерять POSIX-поведение.
9. **CI.** Сделать windows-job блокирующим, матрица Node 20/22 × windows, шаги (lint/typecheck/test/build/smoke), особенности shell в GitHub Actions (`pwsh` vs `bash`), кэш npm.
10. **Документация.** README (EN + RU), AGENTS.md, CHANGELOG, отдельный `docs/windows-support/` отчёт; отдельно — починить ссылку на отсутствующий `docs/windows-cross-platform-report.md` и предложить правку `.gitignore`, чтобы такие отчёты публиковались.
11. **Порядок работ и приёмка.** Фазы с зависимостями, оценка в человеко-днях, критерии готовности каждой фазы (проверяемые), риски и что принципиально нельзя поддержать (например, `.ps1` при restrictive ExecutionPolicy).

### Формат файла

- Язык: русский; код, пути, флаги, имена файлов — как в коде (английский).
- Markdown. Структура: цель и границы → карта проблем (файл:строка) → варианты решений и выбор → фазы с задачами и критериями приёмки → изменения по файлам → тесты → CI → документация → риски → чек-лист приёмки.
- Для каждого изменения указывай файл и, где возможно, эскиз кода (10–30 строк), но не вноси его в репозиторий.
- Опирайся на реальный код: читай файлы, проверяй номера строк. Не выдумывай API.
- Если факт нельзя проверить на этой Linux-машине (поведение Windows), помечай его как «требует проверки на windows-latest» и предлагай, как проверить.

### Куда писать

- Claude: `docs/windows-support/claude-plan.md`
- Antigravity: `docs/windows-support/agy-plan.md`

Каталог уже создан. Не трогай чужие файлы в `docs/windows-support/`. По завершении выведи в stdout одну строку: `PLAN_DONE <путь> <число строк>`.
