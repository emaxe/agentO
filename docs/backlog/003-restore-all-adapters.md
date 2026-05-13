# 003 - Расширить `agento restore` на все адаптеры

## Статус

Backlog

## Приоритет

P0

## Контекст

`agento restore` сейчас поддерживает только `claude-code` и `opencode`, хотя в проекте есть адаптеры `qwen`, `codex`, `copilot`, `goose`, а TUI Agents уже умеет восстанавливать через generic adapter path.

## Проблема

Independent mode оставляет конфиг измененным, а CLI restore не способен восстановить все поддерживаемые агенты. Это особенно опасно для `qwen` и `codex`, которые реально пишут конфиги.

## Цель

Сделать `agento restore` универсальным для всех зарегистрированных адаптеров.

## Scope

- Перевести `restore` на единый agent registry.
- Обновить option description, чтобы список агентов не был захардкожен старым subset.
- Валидировать `scope` через `LaunchScopeSchema`.
- После успешного restore удалять backup через `deleteBackup`.
- Добавить тесты для restore всех релевантных адаптеров.

## Вне scope

- Полная переработка backup format. Это отдельная задача 004.
- Multi-file restore для Codex project scope. Это отдельная задача 006, но текущая задача должна не ухудшать поведение.

## Критерии приемки

- `agento restore -a qwen -s global` поддерживается.
- `agento restore -a codex -s project` хотя бы проходит через adapter path, а финальная корректность Codex закрывается задачей 006.
- Unknown agent выводит актуальный список поддерживаемых agent id.
- Invalid scope дает понятную ошибку.
- После restore backup удаляется.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Ручные проверки после сборки:

```bash
node dist/bin/agento.js restore --help
node dist/bin/agento.js agent status --dev
```

## Риски

- Для env-only адаптеров `copilot` и `goose` `writeConfig` no-op. Нужно решить, должен ли restore для них удалять backup и сообщать "nothing to restore" или проходить как no-op.
- Для Codex project scope текущий adapter пишет в global и project, поэтому нужна связка с задачей 006.

