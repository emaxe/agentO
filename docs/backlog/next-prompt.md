# Prompt For Next Session

Ты работаешь в репозитории AgentO:

```text
/Users/maksimklisin/Desktop/_JS/agento
```

Нужно реализовать следующую задачу из backlog:

```text
docs/backlog/006-codex-project-multifile-transaction.md
```

## Цель

Починить Codex `project` scope как полноценную multi-file transaction: при project launch Codex затрагивает два файла, и оба должны попадать в backup manifest и корректно восстанавливаться через обычный cleanup/CLI restore даже после crash/process exit.

Затрагиваемые файлы для Codex project scope:

- global: `~/.codex/config.toml`
- project: `<cwd>/.codex/config.toml`

Public behavior CLI/TUI должен остаться прежним.

## Контекст

Проект: TypeScript + Node.js ESM CLI, тесты Vitest, сборка через `tsc`. После изменений в `src/` или `bin/` обязательно запускать:

```bash
npm run build
```

Глобальный `agento` использует `dist/`, не `src/`.

Задачи `001`-`005` уже завершены:

- `001`: `prepublishOnly` запускает `npm run lint && npm run build && npm test`.
- `002`: добавлен единый registry в `src/agents/registry.ts`; CLI launch/status, TUI launch/status/install wizard используют registry.
- `003`: `agento restore` переведен на registry, поддерживает все registry-агенты, валидирует scope через `LaunchScopeSchema` и удаляет backup после успешного restore.
- `004`: backup теперь v2 manifest в `~/.agento/backups/<agent>/<scope>.bak.json`; `writeBackup` не перезаписывает active backup; restore/cleanup различает `hadFile: true/false`; legacy raw backups читаются как v2-like manifest.
- `005`: добавлен общий launch transaction layer `src/launcher/transaction.ts`; `prepareChild`, `launchChild`, `launchIndependent` используют общий transaction path; backup/write/env/cleanup logic больше не дублируется между child и independent launchers.

Текущая ветка: `main`, локально может быть ahead of `origin/main`. Может быть неотслеживаемая `.claude/`; не трогай ее.

Если изменения от `005` еще не закоммичены, не откатывай их. Они включают `src/launcher/transaction.ts`, `src/launcher/transaction.test.ts`, изменения в `child.ts`, `independent.ts`, `AGENTS.md`, `CHANGELOG.md` и backlog docs.

## Текущее состояние relevant code

`src/adapters/codex.ts`:

- `configPaths(cwd?)` возвращает:
  - `global`: `~/.codex/config.toml`
  - `project`: `<cwd>/.codex/config.toml`
- `readConfig(scope, cwd?)` читает только один файл выбранного scope.
- `buildConfig(...)` возвращает единый config с `model`, `model_providers`, `default_profile`, `profiles`.
- `writeConfig(config, 'project', cwd?)`:
  - пишет `model_providers`, `default_profile`, `profiles` в global config;
  - пишет `model` в project config;
  - использует module-level `codexGlobalBackup` для process-local restore global config.
- `codexGlobalBackup` теряется при crash/process exit и не интегрирован с `~/.agento/backups`.

`src/launcher/transaction.ts` после `005`:

- `prepareLaunchTransaction(...)` делает single-file backup через `adapter.readConfig(scope, cwd?)` и `adapter.configPaths(cwd)[scope]`;
- затем вызывает `adapter.buildConfig(...)` и `adapter.writeConfig(...)`;
- собирает `ExecRequest` с clean `process.env`, resolved `PATH`, `adapter.buildEnv?.(...)`;
- cleanup читает backup и вызывает `restorePrimaryBackupFile(...)`, затем `deleteBackup(...)`.

`src/config/backup-restore.ts`:

- `restorePrimaryBackupFile(adapter, manifest, scope, cwd?)` восстанавливает только первый файл из manifest;
- при `hadFile: true` вызывает `adapter.writeConfig(content, scope, restoreCwd)`;
- при `hadFile: false` удаляет config path;
- multi-file restore нужно реализовать в этой задаче.

`src/config/store.ts` уже поддерживает v2 manifest с `files[]`:

- `BackupManifest`, `BackupManifestFile`, `WriteBackupOptions`;
- `writeBackup(agentId, scope, { cwd, files, sessionId?, createdAt? })`;
- `readBackup(agentId, scope)` возвращает `BackupManifest | null`;
- `inferBackupFileFormat(path)`;
- `backupExists`, `deleteBackup`, `getBackupPath`.

`src/cli/commands/restore.ts`:

- использует registry и `restorePrimaryBackupFile(...)`;
- после успешного restore удаляет backup.

## Требования к реализации

1. Открой и изучи:

   - `docs/backlog/006-codex-project-multifile-transaction.md`
   - `docs/backlog/CHECKLIST.md`
   - `src/adapters/base.ts`
   - `src/adapters/codex.ts`
   - `src/adapters/codex.test.ts`
   - `src/launcher/transaction.ts`
   - `src/launcher/transaction.test.ts`
   - `src/launcher/child.ts`
   - `src/launcher/independent.ts`
   - `src/config/store.ts`
   - `src/config/backup-restore.ts`
   - `src/config/store.test.ts`
   - `src/cli/commands/restore.ts`
   - `src/cli/commands/restore.test.ts`
   - `src/agents/registry.ts`
   - `bin/agento.ts`

2. Обнови `docs/backlog/CHECKLIST.md`:

   - переведи задачу `006` из `Backlog` в `In Progress` перед началом работы;
   - отмечай процессные чекбоксы по мере выполнения;
   - после успешных проверок переведи задачу в `Done`.

3. Добавь multi-file transaction support без Codex-only state в process memory.

   Требуемое поведение:

   - для обычных адаптеров поведение single-file transaction не меняется;
   - для Codex `global` scope поведение не меняется: один global config file;
   - для Codex `project` scope backup manifest должен содержать два files entries:
     - global Codex config file;
     - project Codex config file;
   - если `writeBackup` падает из-за existing active backup, ни global, ни project config не должны быть записаны;
   - cleanup и `agento restore -a codex -s project` должны восстанавливать оба файла из manifest;
   - `hadFile: false` должен удалять соответствующий файл при restore/cleanup;
   - restore не должен зависеть от `codexGlobalBackup`.

   Предпочтительно сделать это как расширение общей transaction архитектуры, а не как ad hoc branch в CLI restore. Возможные варианты:

   - добавить в `AgentAdapter` optional hooks для transaction backup/restore affected files;
   - или добавить отдельный typed helper/protocol рядом с transaction layer.

   Выбирай вариант, который минимально ломает существующий интерфейс и сохраняет `readConfig` → `buildConfig` → `writeConfig` pipeline для обычных адаптеров.

4. Убери `codexGlobalBackup` как source of truth.

   - Module-level `codexGlobalBackup` не должен быть нужен для корректного restore.
   - Если останется какой-то локальный helper/cache, он не должен влиять на crash-like restore через backup manifest.
   - Codex project `writeConfig` должен консервативно merge global TOML:
     - сохранять unrelated global keys;
     - обновлять только AgentO-owned keys: `model_providers`, `default_profile`, `profiles` (или четко зафиксированную более узкую ownership-модель, если выберешь ее);
     - project file должен содержать project-owned `model`.

5. Реализуй multi-file restore.

   - Можно заменить/расширить `restorePrimaryBackupFile(...)`, но сохрани compatibility для single-file callers/tests.
   - `restore` CLI и transaction cleanup должны использовать multi-file restore path.
   - Для restore каждого file entry:
     - если `hadFile: true`, вернуть `content`;
     - если `hadFile: false`, удалить `path` если существует;
     - cleanup должен удалить active backup после успешного restore, как сейчас.
   - Для Codex project restore нельзя восстанавливать оба файла через один `adapter.writeConfig(content, 'project')`, потому что global и project entries имеют разные physical paths. Нужен путь, который пишет/удаляет конкретный manifest file или использует adapter hook с явным file entry.

6. Сохрани public contracts.

   - CLI/TUI flags и UX не меняй.
   - Backup path/layout не меняй: `~/.agento/backups/<agent>/<scope>.bak.json`.
   - v2 manifest schema не ломай; можно использовать существующий `files[]`.
   - Independent mode semantics не меняй: это `011`.
   - Secret redaction не реализуй: это `010`.
   - Atomic writes/permissions не реализуй: это `009`.
   - Не добавляй OpenAI-compatible provider type в Codex, если это не требуется для этой задачи.
   - Не форматируй весь проект.
   - Не трогай `.claude/`.

## Тесты

Обнови существующие тесты и добавь focused cases. Минимум покрыть:

- transaction для обычного адаптера по-прежнему пишет single-file v2 backup и делает cleanup;
- Codex `project` transaction пишет backup manifest с двумя files entries: global и project;
- Codex `project` transaction записывает global и project configs только после successful backup;
- Codex `project` transaction не записывает ни один config file, если active backup уже существует;
- cleanup/restore при `hadFile: true` восстанавливает оба Codex файла;
- cleanup/restore при `hadFile: false` удаляет оба Codex файла;
- mixed case: global existed, project missing;
- mixed case: global missing, project existed;
- crash-like restore through CLI: создать backup manifest для `codex/project`, затем вызвать restore command path и проверить оба файла;
- unrelated global Codex keys сохраняются при project launch и возвращаются/сохраняются после restore;
- legacy/single-file restore behavior для других адаптеров не сломан.

Тесты не должны писать в реальные пользовательские конфиги. Используй `mkdtemp`, mock `homedir`, temp `cwd`, Vitest spies/mocks и существующие паттерны.

## Документация

После кода обнови только по делу:

- `docs/backlog/006-codex-project-multifile-transaction.md`: статус `Done` после успешных проверок; при необходимости зафиксируй выбранный multi-file transaction design.
- `docs/backlog/CHECKLIST.md`: задача `006` отмечена как выполненная.
- `AGENTS.md`: обнови раздел Codex adapter / Launch / Backup patterns, если изменится adapter interface, transaction hooks или restore behavior.
- `CHANGELOG.md`: добавь запись в `[Unreleased]` про Codex project multi-file backup/restore.
- `README.md` / `README.ru.md` обновляй только если пользовательское поведение изменилось. В этой задаче оно не должно измениться, кроме исправления надежности restore.

## Обязательные проверки

Запусти:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

После сборки выполни smoke:

```bash
node dist/bin/agento.js launch --help
node dist/bin/agento.js agent status --dev
```

В конце обязательно:

```bash
npm run prepublishOnly
```

Если проверка упала, исправь причину и повтори релевантные проверки. Так как `prepublishOnly` запускает build, после финальных doc-only правок всё равно повтори `npm run prepublishOnly`, чтобы финальное состояние было проверено.

## Definition Of Done

- Codex project launch создает v2 backup manifest с global и project files.
- Restore/cleanup восстанавливает или удаляет оба файла согласно `hadFile`.
- Crash-like restore через `agento restore -a codex -s project` работает без process-local `codexGlobalBackup`.
- Existing active backup no-overwrite policy сохранена: новый config не пишется при existing backup.
- Unrelated global Codex TOML keys не теряются.
- Single-file adapters продолжают работать через общий transaction layer.
- Public CLI/TUI behavior не изменился.
- Tests покрывают multi-file transaction, restore и regression для single-file path.
- `npm run lint` проходит.
- `npm run typecheck` проходит.
- `npm test` проходит.
- `npm run build` проходит.
- CLI smoke-команды проходят.
- `npm run prepublishOnly` проходит.
- `docs/backlog/CHECKLIST.md`, `docs/backlog/006-codex-project-multifile-transaction.md`, `AGENTS.md`, `CHANGELOG.md` обновлены по смыслу.

## Финальный ответ

В финальном ответе кратко укажи:

- какие файлы изменены;
- какой design выбран для multi-file transaction/restore;
- как теперь работает Codex project backup/restore;
- что осталось вне scope для задач `009`, `010`, `011`;
- какие проверки запущены и результат.
