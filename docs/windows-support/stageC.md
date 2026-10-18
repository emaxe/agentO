# Stage C — Фаза 3: инсталлеры, детект, PATH, пути конфигов

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support`. Читай
`docs/windows-support/plan.md` (§3.3, §3.5, §3.9, §4 Ф3).

Сделано ранее: `src/platform/*` (spawn, resolve-executable, env, kill-tree), все запуски переведены
на обёртки, 744 теста зелёные, Windows-job в CI зелёный.

## Цель

Привести установку/детект агентов и PATH к рабочему состоянию на Windows, не меняя поведение на
macOS/Linux (кроме исправления заведомо сломанного `opencode`).

## 1. Installer API (`src/installers/base.ts`)

- `InstallCheckResult`: добавить необязательное `reason?: 'not-found' | 'failed' | 'timeout'`.
- `AgentInstaller`: `manualInstructions` расширить необязательным `windows?: { commands: string[] }`;
  `checkEnvironment()` и `install()` остаются без аргументов (платформа — через конструктор/фабрику).
- Все инсталлеры сделать фабриками с инъекцией платформы:
  `export function createXInstaller(options: { platform?: NodeJS.Platform } = {}): AgentInstaller`
  и сохранить существующие экспортируемые синглтоны (`export const xInstaller = createXInstaller()`),
  чтобы не менять реестр и вызовы.

## 2. `src/installers/npm.ts`

- Вынести общий `runNpm(args, opts)` вместо трёх копий `install/update/uninstall`; внутри —
  `spawnCommand('npm', args, { stdio: ['ignore','inherit','pipe'] })` + сбор stderr.
- `checkInstalled`: `spawnCommandSync(config.command, ['--version'], { encoding:'utf8', timeout:10_000, env: await resolvedEnv() })`.
  Разбор:
  - `result.error?.code === 'ENOENT'` → `{installed:false, reason:'not-found'}`;
  - `result.error?.code === 'ETIMEDOUT'` (или `signal === 'SIGTERM'` при timeout) → `reason:'timeout'`;
  - `status !== 0` → `reason:'failed'`;
  - иначе `installed:true` + версия.
- `checkEnvironment`: `npm --version` с тем же env; отсутствие → `missing:['npm']`.
- `resolvedEnv()` — `{...process.env, PATH: await shellPathResolver.resolve()}` (импорт из
  `../launcher/shell-path-resolver.js`). На POSIX это не меняет поведение (resolve возвращает
  текущий PATH, объединённый с login-shell).
- После успешных `install/update/uninstall` вызывать `shellPathResolver.invalidate()`.
- Распознавать `EPERM`/`EACCES` в stderr и добавлять подсказку:
  `npm config set prefix %APPDATA%\\npm` (Windows) / `sudo` (POSIX) — текст в `error`.

## 3. `src/installers/opencode.ts`

Исправить `packageName: 'opencode'` → `'opencode-ai'` (проверено: `opencode` в npm не существует,
`opencode-ai` — 1.19.3). Это баг на всех ОС; добавь тест на конфиг инсталлера.

## 4. Windows-каналы

- **copilot** (`copilot.ts`): на win32 — `winget --version` → `winget install --id GitHub.Copilot -e
  --accept-source-agreements --accept-package-agreements`; если winget нет — npm-пакет
  `@github/copilot` (существует); если нет ни того, ни другого — manual. На darwin оставить brew.
  На linux — npm → manual. id `GitHub.Copilot` помечен как «проверить» в отчёте.
- **goose** (`goose.ts`): на win32 автоустановку **не делать** (manual only: winget id не подтверждён;
  в manual добавь `winget search goose` и ссылку на релизы). На darwin — brew как сейчас.
- **kimi** (`kimi.ts`): на win32 — проверка `uv --version`; установка
  `uv tool install --python 3.13 kimi-cli`, обновление `uv tool upgrade kimi-cli`, удаление
  `uv tool uninstall kimi-cli`; если `uv` нет — manual (`pip install kimi-cli` + ссылка на uv).
  На win32 **никогда** не вызывать `bash`/`curl`-скрипт. На POSIX — как сейчас.
- Для всех: `checkInstalled` использует `spawnCommandSync` (уже), добавляет `timeout` и `reason`.

## 5. PATH (`src/launcher/shell-path-resolver.ts`)

- Сохранить win32-ветку (`;`, без login-shell, `Path`/`PATH`).
- Добавить `WIN32_FALLBACK_PATHS`, применяемые только на win32 и только если каталог существует
  (`existsSync`): `%APPDATA%\\npm`, `%LOCALAPPDATA%\\pnpm`, `%LOCALAPPDATA%\\Microsoft\\WinGet\\Links`,
  `%USERPROFILE%\\.local\\bin`, `%USERPROFILE%\\.cargo\\bin`, `%USERPROFILE%\\scoop\\shims`,
  `%ProgramFiles%\\nodejs`. Не дублировать уже присутствующие элементы.
- `invalidate()` уже есть — используется инсталлерами.
- Тесты: win32-фолбэки с моком `existsSync`/`platform:'win32'`; POSIX-поведение не меняется.

## 6. `src/adapters/codex.ts`

`process.env.HOME ?? homedir()` → `process.env.CODEX_HOME ?? join(homedir(), '.codex')` (с сохранением
семантики путей). Убедиться, что на POSIX результат прежний при заданном/незаданном `HOME`.

## 7. Пути конфигов на Windows (исследование, без спекуляций)

Не меняй `configPaths` наугад. Задача:
1. Собрать по официальной документации/репозиториям агентов фактические пути конфигов на Windows
   для 9 агентов (можно `WebSearch`/`WebFetch`).
2. Записать таблицу в `docs/windows-support/config-paths.md`: агент, текущий путь в коде, ожидаемый
   на Windows, источник (URL), статус `подтверждено документацией` / `требует проверки на машине`.
3. Кодовые правки — только если документация явно противоречит текущему коду **и** это путь,
   который агент читает (например, goose `%APPDATA%\\Block\\goose\\config\\config.yaml`).
   Каждую правку — с win32-ветвлением и тестом; POSIX-путь не меняется.
4. Если уверенности нет — оставь код как есть и отметь в таблице. Лучше честный «проверить»,
   чем сломанный путь.

## 8. Windows-only интеграционный тест (обязательно)

`src/platform/spawn.windows.test.ts` с `describe.skipIf(process.platform !== 'win32')`:
- создать во временном каталоге `fake agent.cmd` (пробел в имени) с телом
  `@echo off` + `echo %*` + `exit /b 7`;
- `spawnCommand(путь, ['a b', '&calc', '"q"'], { stdio:['ignore','pipe','pipe'] })` → код 7,
  stdout содержит аргументы буквально, `&calc` не исполняется;
- `spawnCommand('definitely-not-a-command-xyz')` → событие `error` с `code:'ENOENT'`;
- `resolveExecutable('cmd', process.env)` находит `cmd.exe` и возвращает `kind:'native'`.
Этот тест должен реально выполниться на windows-latest в CI (файл не скипается там).

## 9. Проверки

```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
```
Зелёные на Linux, тестов ≥ 744. Существующие POSIX-тесты не ослаблять.

## 10. Отчёт

В stdout:
```
STAGE_C_DONE
tests: <passed>/<skipped>/<total>
files: <изменённые/созданные>
notes: <что требует проверки на реальной Windows>
```
и продублируй в `docs/windows-support/runs/stageC-report.md`. Отдельно перечисли: какие инсталлеры
получили windows-ветку, какие winget-id/имена пакетов не подтверждены, что в таблице путей
«подтверждено», а что «требует проверки».

## Границы
- Не коммить и не пушь.
- Не трогать сигналы, `atomic-write`, прокси, TUI, CI, README/AGENTS.md — это Stage D/E/F.
- Не менять `configPaths` без документального подтверждения.
