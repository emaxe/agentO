# Prompt For Next Session

Ты работаешь в репозитории AgentO:

```text
/Users/maksimklisin/Desktop/_JS/agento
```

Нужно реализовать следующую задачу из backlog:

```text
docs/backlog/003-restore-all-adapters.md
```

## Цель

Расширить `agento restore` на все зарегистрированные адаптеры, чтобы CLI restore использовал тот же единый registry агентов, что launch/status/TUI, и больше не был ограничен старым subset `claude-code`, `opencode`.

## Контекст

Проект: TypeScript + Node.js ESM CLI, тесты Vitest, сборка через `tsc`. После изменений в `src/` или `bin/` обязательно запускать:

```bash
npm run build
```

Глобальный `agento` использует `dist/`, не `src/`.

Задачи `001` и `002` уже завершены:

- `001`: `prepublishOnly` запускает `npm run lint && npm run build && npm test`.
- `002`: добавлен единый registry в `src/agents/registry.ts`; CLI launch/status, TUI launch/status/install wizard используют registry.

Текущая ветка после предыдущей сессии:

- `main` содержит локальный коммит `feat: add unified agent registry`.
- `main` может быть `ahead 1` относительно `origin/main`.
- Неотслеживаемую `.claude/`, если она есть, не трогать.

## Текущее состояние restore

`src/cli/commands/restore.ts` сейчас:

- импортирует только `claudeCodeAdapter` и `openCodeAdapter`;
- хранит локальный `ADAPTERS`;
- help text показывает только `Agent id (claude-code, opencode)`;
- кастит `opts.scope as LaunchScope`;
- не вызывает `deleteBackup` после успешного restore.

Это нужно исправить.

## Требования к реализации

1. Открой и изучи:
   - `docs/backlog/003-restore-all-adapters.md`
   - `docs/backlog/CHECKLIST.md`
   - `src/cli/commands/restore.ts`
   - `src/agents/registry.ts`
   - `src/config/schema.ts`
   - `src/config/store.ts`
   - `src/tui/screens/Agents.tsx`
   - существующие тесты `src/config/store.test.ts`, `src/launcher/child.test.ts`, `src/agents/registry.test.ts`

2. Обнови `docs/backlog/CHECKLIST.md`:
   - переведи задачу `003` из `Backlog` в `In Progress` перед началом работы;
   - отмечай процессные чекбоксы по мере выполнения;
   - после успешных проверок переведи задачу в `Done`.

3. Переведи `src/cli/commands/restore.ts` на единый registry:
   - используй `getAgent` / `listAgents` из `src/agents/registry.ts`;
   - для restore development agents используй `{ dev: true }`, чтобы CLI restore мог восстановить `codex` без отдельного `--dev` флага;
   - не создавай локальный полный список адаптеров.

4. Обнови help/error text:
   - option description должен строиться из актуального registry списка;
   - unknown agent должен выводить актуальный список поддерживаемых ids в registry order:
     `claude-code, opencode, qwen, codex, copilot, goose`.

5. Валидируй scope через `LaunchScopeSchema`:
   - импортируй `LaunchScopeSchema` из `src/config/schema.ts`;
   - не используй unsafe cast `opts.scope as LaunchScope`;
   - invalid scope должен давать понятную ошибку и exit code `1`.

6. После успешного restore удаляй backup:
   - используй `deleteBackup` из `src/config/store.ts`;
   - порядок: `readBackup` → `adapter.writeConfig(...)` → `deleteBackup(...)` → success message.

7. Сохрани текущее поведение там, где оно корректно:
   - если backup не найден, выводить ошибку и не вызывать `writeConfig`;
   - если `readBackup` вернул `null`, выводить ошибку и не вызывать `writeConfig`;
   - success message может остаться в текущем стиле: `Restored <agent> config (<scope>)`.

8. Обработай env-only адаптеры прагматично:
   - `copilot` и `goose` имеют no-op `writeConfig`, но restore всё равно должен идти через adapter path;
   - если backup есть, после no-op restore backup должен удаляться;
   - не вводи отдельную семантику "nothing to restore" в этой задаче.

9. Не делай unrelated refactor:
   - не меняй backup format, это задача `004`;
   - не решай multi-file Codex project restore полностью, это задача `006`;
   - не меняй пользовательский CLI API;
   - не форматируй весь проект;
   - не трогай `.claude/`.

## Тесты

Добавь focused tests для restore command. Если текущая структура не имеет тестов CLI command, создай новый файл рядом с командой, например:

```text
src/cli/commands/restore.test.ts
```

Минимум покрыть:

- `restore` поддерживает нестарый агент, например `qwen`.
- `restore` поддерживает dev-agent `codex` без отдельного `--dev`.
- unknown agent выводит список из registry.
- invalid scope завершается ошибкой до чтения backup/writeConfig.
- successful restore вызывает `adapter.writeConfig` и затем `deleteBackup`.
- no backup не вызывает `adapter.writeConfig` и `deleteBackup`.

Тесты должны быть сфокусированы и не писать в реальные пользовательские конфиги. Используй Vitest mocks/spies или временные директории по существующим паттернам проекта.

## Документация

После кода обнови только по делу:

- `docs/backlog/003-restore-all-adapters.md`: статус `Done` после успешных проверок.
- `docs/backlog/CHECKLIST.md`: задача `003` отмечена как выполненная.
- `AGENTS.md`: обнови описание `agento restore`, если там всё ещё подразумевается ограниченный список адаптеров или нет упоминания registry.
- `CHANGELOG.md`: добавь запись в `[Unreleased]` про universal restore через agent registry и удаление backup после успешного restore.
- `README.md` / `README.ru.md` обновляй только если там есть пользовательски видимое описание ограниченного restore. Если такого нет, не трогай.

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

Если проверка упала, исправь причину и повтори релевантные проверки.

## Definition Of Done

- `agento restore` использует `src/agents/registry.ts`.
- Нет локального `ADAPTERS`, который дублирует список агентов.
- `qwen`, `codex`, `copilot`, `goose` поддерживаются restore path.
- Unknown agent показывает актуальный registry list.
- Invalid scope валидируется через `LaunchScopeSchema`.
- После успешного restore backup удаляется.
- Focused tests для restore добавлены и проходят.
- `npm run lint` проходит.
- `npm run typecheck` проходит.
- `npm test` проходит.
- `npm run build` проходит.
- CLI smoke-команды проходят.
- `npm run prepublishOnly` проходит.
- `docs/backlog/CHECKLIST.md`, `docs/backlog/003-restore-all-adapters.md`, `AGENTS.md`, `CHANGELOG.md` обновлены по смыслу.

## Финальный ответ

В финальном ответе кратко укажи:

- какие файлы изменены;
- какие проверки запущены и результат;
- какие агенты теперь поддерживает `restore`;
- удаляется ли backup после успешного restore;
- есть ли остаточные риски, особенно по Codex project scope до задачи `006`.
