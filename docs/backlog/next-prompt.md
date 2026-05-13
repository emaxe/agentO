# Prompt For Next Session

Ты работаешь в репозитории AgentO:

```text
/Users/maksimklisin/Desktop/_JS/agento
```

Нужно реализовать следующую задачу из backlog:

```text
docs/backlog/004-backup-session-format.md
```

## Цель

Сделать backup/restore безопаснее: заменить legacy backup-файл, который хранит только JSON-содержимое конфига, на v2 manifest с `sessionId`, `createdAt`, `cwd`, `hadFile` и списком файлов. Это должно убрать риск тихой перезаписи original backup при повторном launch и позволить restore понимать, нужно восстановить файл или удалить файл, которого до launch не было.

## Контекст

Проект: TypeScript + Node.js ESM CLI, тесты Vitest, сборка через `tsc`. После изменений в `src/` или `bin/` обязательно запускать:

```bash
npm run build
```

Глобальный `agento` использует `dist/`, не `src/`.

Задачи `001`, `002`, `003` уже завершены:

- `001`: `prepublishOnly` запускает `npm run lint && npm run build && npm test`.
- `002`: добавлен единый registry в `src/agents/registry.ts`; CLI launch/status, TUI launch/status/install wizard используют registry.
- `003`: `agento restore` переведен на registry, поддерживает `claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`, валидирует scope через `LaunchScopeSchema` и удаляет backup после успешного restore.

Текущее рабочее дерево после сессии `003` может содержать незакоммиченные изменения:

- `src/cli/commands/restore.ts`
- `src/cli/commands/restore.test.ts`
- `docs/backlog/003-restore-all-adapters.md`
- `docs/backlog/CHECKLIST.md`
- `AGENTS.md`
- `CHANGELOG.md`
- неотслеживаемая `.claude/`

Не трогай `.claude/`. Если изменения `003` еще не закоммичены, работай поверх них аккуратно и не откатывай.

## Текущее состояние backup

`src/config/store.ts` сейчас:

- пишет backup в фиксированный путь `~/.agento/backups/<agent>/<scope>.bak.json`;
- `writeBackup(agentId, scope, content)` сериализует только `content`;
- `readBackup(agentId, scope)` возвращает `unknown | null`;
- `backupExists`, `deleteBackup`, `getBackupPath` работают только с этим fixed path.

`src/launcher/child.ts` и `src/launcher/independent.ts` сейчас:

- читают текущий конфиг через `adapter.readConfig(scope, cwd)`;
- пишут backup как `currentConfig ?? {}`;
- отдельно держат `hadConfig` в памяти только для child cleanup;
- repeated independent launch может перезаписать original backup.

`src/cli/commands/restore.ts` и `src/tui/screens/Agents.tsx` сейчас:

- читают backup;
- если backup не `null`, вызывают `adapter.writeConfig(backup as Record<string, unknown>, scope)`;
- не умеют отличить "исходного файла не было" от "исходный конфиг был `{}`".

## Требования к реализации

1. Открой и изучи:
   - `docs/backlog/004-backup-session-format.md`
   - `docs/backlog/CHECKLIST.md`
   - `src/config/store.ts`
   - `src/config/store.test.ts`
   - `src/launcher/child.ts`
   - `src/launcher/child.test.ts`
   - `src/launcher/independent.ts`
   - `src/cli/commands/restore.ts`
   - `src/cli/commands/restore.test.ts`
   - `src/tui/screens/Agents.tsx`
   - `src/adapters/codex.ts`
   - `docs/backlog/006-codex-project-multifile-transaction.md`

2. Обнови `docs/backlog/CHECKLIST.md`:
   - переведи задачу `004` из `Backlog` в `In Progress` перед началом работы;
   - отмечай процессные чекбоксы по мере выполнения;
   - после успешных проверок переведи задачу в `Done`.

3. Спроектируй и добавь v2 backup manifest.

   Базовый формат должен быть совместим с описанием backlog:

   ```ts
   interface BackupManifest {
     version: 2;
     sessionId: string;
     agentId: string;
     scope: 'global' | 'project';
     cwd?: string;
     createdAt: string;
     files: Array<{
       path: string;
       format: 'json' | 'toml' | 'yaml' | 'raw' | 'none';
       hadFile: boolean;
       content: unknown;
     }>;
   }
   ```

   Можно хранить типы в `src/config/store.ts` или рядом, если это лучше вписывается в проект. Не добавляй новый runtime dependency без необходимости.

4. Обнови API backup-store прагматично.

   Нужно обновить `writeBackup`, `readBackup`, `backupExists`, `deleteBackup`, `getBackupPath`.

   Важные условия:

   - `readBackup` должен читать v2 manifest.
   - `readBackup` должен сохранять backward compatibility с legacy backup-файлами, где файл содержит только старый raw config object. Для legacy допустимо нормализовать в v2-like manifest с одним файлом и `hadFile: true`, потому что старый формат не хранил отсутствие файла.
   - `writeBackup` должен писать v2 manifest с `sessionId`, `createdAt`, `agentId`, `scope`, `cwd`, `files`.
   - `writeBackup` не должен тихо перезаписывать существующий active backup для того же `agentId/scope`. Для этой задачи выбери conservative policy: если backup уже есть, бросить понятную ошибку с инструкцией восстановить через `agento restore -a <agent> -s <scope>` перед новым launch.
   - `deleteBackup` остается idempotent.
   - `getBackupPath` может остаться fixed active path `~/.agento/backups/<agent>/<scope>.bak.json`; менять layout на session-specific directories не обязательно в этой задаче.

5. Обнови launch paths.

   В `src/launcher/child.ts` и `src/launcher/independent.ts`:

   - передавай в backup manifest `cwd`;
   - передавай `path` из `adapter.configPaths(cwd)[scope]`;
   - передавай `hadFile` на основе `currentConfig !== null`;
   - передавай `content: currentConfig` если файл был, и нейтральное значение (`null` или `{}`) если файла не было, но не используй это значение как признак отсутствия;
   - если active backup уже существует, launch должен упасть до `adapter.writeConfig(newConfig, ...)`.

6. Обнови restore/cleanup semantics для single-file path.

   Для `src/cli/commands/restore.ts`, `src/tui/screens/Agents.tsx` и child cleanup:

   - если v2 manifest говорит `hadFile: true`, восстанови content через `adapter.writeConfig(file.content as Record<string, unknown>, scope, cwd?)`;
   - если `hadFile: false`, удали файл по `file.path` или по `adapter.configPaths(cwd)[scope]`, если path отсутствует/legacy;
   - после успешного restore/cleanup удаляй backup;
   - legacy backup должен продолжать восстанавливаться как раньше через `adapter.writeConfig(...)`;
   - не делай полный multi-file Codex restore в этой задаче, но структура manifest должна позволять `files.length > 1` для задачи `006`.

   Если для удаления файла нужен helper, сделай его маленьким и локальным. Не начинай full transaction refactor: это задача `005`.

7. Обнови status behavior.

   `backupExists(agentId, scope)` по-прежнему должен корректно питать:

   - `agento agent status`
   - TUI Agents screen

   Для этой задачи достаточно статуса "backup exists / original"; не добавляй новый UI со списком sessionId, если это требует лишней работы.

8. Не делай unrelated refactor:

   - не реализуй secret redaction, это задача `010`;
   - не делай общий transaction layer, это задача `005`;
   - не закрывай полностью Codex project multi-file transaction, это задача `006`;
   - не меняй пользовательский CLI API (`agento restore -a <agent> -s <scope>` должен остаться);
   - не форматируй весь проект;
   - не трогай `.claude/`.

## Тесты

Обнови существующие тесты и добавь focused cases. Минимум покрыть:

- `writeBackup` пишет v2 manifest с `version: 2`, `sessionId`, `createdAt`, `agentId`, `scope`, `cwd`, `files[0].path`, `files[0].hadFile`, `files[0].content`.
- `readBackup` читает v2 manifest.
- `readBackup` читает legacy raw backup и нормализует его так, чтобы restore мог работать.
- `writeBackup` не перезаписывает existing backup и бросает понятную ошибку.
- `backupExists` / `deleteBackup` работают для v2.
- child/independent launch не вызывают `adapter.writeConfig` если active backup уже есть.
- child cleanup при `hadFile: false` удаляет исходный config path, а не пишет `{}`.
- CLI restore при `hadFile: false` удаляет config path и затем вызывает `deleteBackup`.
- CLI restore legacy backup продолжает вызывать `adapter.writeConfig` и `deleteBackup`.

Используй Vitest mocks/spies или временные директории по существующим паттернам проекта. Тесты не должны писать в реальные пользовательские конфиги.

## Документация

После кода обнови только по делу:

- `docs/backlog/004-backup-session-format.md`: статус `Done` после успешных проверок; при необходимости зафиксируй выбранную policy для existing backup.
- `docs/backlog/CHECKLIST.md`: задача `004` отмечена как выполненная.
- `AGENTS.md`: обнови Backup / Restore semantics, особенно v2 manifest, `hadFile`, active backup overwrite policy.
- `CHANGELOG.md`: добавь запись в `[Unreleased]` про v2 backup manifest, отказ от silent overwrite и корректное восстановление отсутствующего исходного файла.
- `README.md` / `README.ru.md` обновляй только если текущий текст про backup/restore становится пользовательски неверным после новой policy.

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
node dist/bin/agento.js restore --help
node dist/bin/agento.js agent status --dev
```

В конце обязательно:

```bash
npm run prepublishOnly
```

Если проверка упала, исправь причину и повтори релевантные проверки. Так как `prepublishOnly` запускает build, после финальных doc-only правок всё равно повтори `npm run prepublishOnly`, чтобы финальное состояние было проверено.

## Definition Of Done

- Backup files пишутся как v2 manifest.
- Legacy backup files читаются и восстанавливаются.
- Active backup для `agentId/scope` не перезаписывается silently.
- Launch падает до patch/writeConfig, если active backup уже существует.
- Restore/cleanup различает `hadFile: true` и `hadFile: false`.
- Restore удаляет backup после успешного восстановления.
- `agent status` и TUI Agents продолжают корректно показывать наличие backup.
- Tests покрывают v2, legacy, no-overwrite и hadFile=false restore.
- `npm run lint` проходит.
- `npm run typecheck` проходит.
- `npm test` проходит.
- `npm run build` проходит.
- CLI smoke-команды проходят.
- `npm run prepublishOnly` проходит.
- `docs/backlog/CHECKLIST.md`, `docs/backlog/004-backup-session-format.md`, `AGENTS.md`, `CHANGELOG.md` обновлены по смыслу.

## Финальный ответ

В финальном ответе кратко укажи:

- какие файлы изменены;
- какой v2 backup format реализован;
- какая policy выбрана для existing active backup;
- как теперь обрабатывается исходно отсутствующий config file;
- какие проверки запущены и результат;
- какие ограничения остались для задач `005`, `006`, `010`.
