# Stage F — Фаза 6: блокирующий CI и документация

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support`. Читай
`docs/windows-support/plan.md` (§3.7, §11, §12) и `docs/windows-support/config-paths.md`.

Сделано: платформенный слой, инсталлеры, сигналы/ФС/восстановление, TUI. 885 тестов зелёные,
Windows-CI зелёный. Осталась финальная стадия.

## 1. CI (`.github/workflows/ci.yml`)

- Убрать `experimental`/`continue-on-error`; windows-job становится блокирующим.
- Матрица: `os: [ubuntu-latest, macos-latest, windows-latest]`, `node: ['18','20','22']`,
  `exclude: [{os: windows-latest, node: '18'}]` (vitest 4 требует Node ≥ 20.12).
- `timeout-minutes: 15` на job.
- `defaults.run.shell: bash` (Git Bash есть на windows-раннере) — единый синтаксис; нативные
  проверки отдельными шагами:
  - `pwsh`: `node dist\bin\agento.js --version` и `node dist\bin\agento.js agent status`;
  - `cmd`: `npm pack --silent`, установка полученного tgz глобально, `agento --version`
    (проверяет именно `.cmd`-шим, который создаёт npm).
- При падении тестов — `actions/upload-artifact` с junit-репортом. Для этого шаг Test на Node ≥ 20
  запускать как `npx vitest run --reporter=junit --outputFile=reports/junit.xml` (или добавь
  отдельный скрипт в package.json, не ломая `npm test`).
- Комментарий про «Windows known incomplete» удалить.
- Branch protection не меняй (нет прав/не входит в задачу) — отметь в отчёте, что включение
  обязательных чеков делает владелец репозитория.

## 2. README.md (EN)

- В Requirements убрать «**macOS or Linux.** Windows is not supported today…» и заменить на:
  поддерживаемые ОС (macOS, Linux, Windows 10 1809+/11), требования (Node ≥ 18, для Windows
  рекомендуется Node 20+ и Windows Terminal), что работает.
- Добавить короткий раздел **Windows**:
  - установка `npm i -g @emaxe/agento`, запуск из PowerShell/Windows Terminal/cmd;
  - агенты ставятся через npm/winget/uv там, где это поддержано; goose — только вручную
    (команда и ссылка);
  - ограничения: `.ps1`-шимы при restrictive ExecutionPolicy не поддерживаются; нет graceful
    SIGTERM — Ctrl+C/закрытие окна завершают дерево процессов; при жёстком kill конфиг
    восстанавливается при следующем запуске;
  - troubleshooting: PATH после установки (перезапуск терминала или `agento` подхватит
    `%APPDATA%\npm`), длинные пути (`LongPathsEnabled`), «Active backup already exists» →
    `agento restore`;
  - ссылка на `docs/windows-support/report.md` и `config-paths.md`.
- Исправить битую ссылку на `docs/windows-cross-platform-report.md` (её больше нет).

## 3. README.ru.md (RU)

То же содержание по-русски, синхронно с EN. Не переводить команды/флаги.

## 4. AGENTS.md

- В структуру добавить `src/platform/*`.
- Правила:
  - запуск процессов только через `src/platform/spawn.ts` (прямой `node:child_process` запрещён
    ESLint, исключение — POSIX login-shell probe);
  - `process.platform` читать только в `src/platform/*` или через инъекцию `platform`;
  - новые тесты не используют POSIX-литералы путей, платформа — параметр;
  - win32-нюансы: `Path`/`PATH`, `homedir()` вместо `HOME`, `.cmd`-шимы, tree kill.
- В чек-лист публикации добавить: windows-job должен быть зелёным.

## 5. CHANGELOG.md

Секция `[Unreleased]`:
- **Added**: Windows support (launch `.cmd`/`.exe`, install channels, tree kill, PATH fallbacks,
  crash recovery, TUI fixes, blocking Windows CI).
- **Changed**: `codex` uses `CODEX_HOME`/`homedir()`; `atomic-write` retries on Windows; proxy stop
  closes connections; independent launch will be handled in the same change set (если применимо).
- **Fixed**: `opencode` npm package name (`opencode-ai`); Path/PATH duplicate key; uppercase ЙЦУКЕН;
  CR/LF paste; TUI without TTY exits cleanly.
Формулировки — краткие, в стиле существующего файла, со ссылками на §, если принято.

## 6. `docs/windows-support/report.md` (новый, итоговый)

Структура:
- что поддерживается и на каких версиях Windows/Node;
- что проверено автоматически: CI `windows-latest` Node 20/22, тесты (включая реальный `.cmd`-шим
  и `taskkill`), сборка, smoke через pwsh/cmd;
- что проверено только юнит-тестами (сигналы, восстановление после kill) — требует ручной приёмки;
- таблица: агент → канал установки на Windows → авто/вручную → статус;
- ссылка на `config-paths.md` и известные расхождения;
- известные ограничения (goose manual, `.ps1`/ExecutionPolicy, нет graceful SIGTERM, отложенное
  восстановление после hard-kill, шифрование ключей не делаем);
- **ручной чек-лист** из плана §8 (Windows Terminal + conhost, PowerShell + cmd) со статусами
  «не проверено» — честно, без выдуманных результатов;
- что осталось на будущее (ConPTY e2e, ACL/DPAPI, `GOOSE_PATH_ROOT` и прочие env-override).

## 7. Проверки

```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
grep -rn "windows-cross-platform-report" . --exclude-dir=node_modules --exclude-dir=.git
grep -rn "not supported" README.md README.ru.md
```
Последние две — пусто (кроме исторических записей в CHANGELOG, если они уместны; лучше без них).
Проверь YAML CI локально: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`.

## 8. Отчёт

```
STAGE_F_DONE
tests: <passed>/<skipped>/<total>
files: <изменённые/созданные>
notes: <что осталось владельцу репозитория: branch protection, ручная приёмка Windows>
```
Продублируй в `docs/windows-support/runs/stageF-report.md`.

## Границы
- Не коммить и не пушь.
- Не менять код приложения, кроме CI/документации. Если заметил дефект — опиши в отчёте, не правь.
- Не выдумывать результаты ручной проверки Windows: только «не проверено» или «проверено в CI».
