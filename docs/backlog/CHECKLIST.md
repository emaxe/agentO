# AgentO Backlog Checklist

Этот файл является единым трекером выполнения backlog-задач. При работе над задачей обновляйте строку задачи и процессные чекбоксы: `Started`, `Implementation`, `Tests`, `Docs`, `Done`.

## Легенда статусов

- `Backlog` - задача описана, работа не начата.
- `In Progress` - задача взята в работу.
- `Review` - код готов, требуется проверка.
- `Done` - задача завершена, проверки пройдены, документация обновлена.
- `Blocked` - задача заблокирована внешней причиной или требует решения по продукту.

## Общий список

| ID | Задача | Приоритет | Статус | Файл |
| --- | --- | --- | --- | --- |
| 001 | Починить lint и добавить release gate | P0 | Done | [001-lint-release-gate.md](./001-lint-release-gate.md) |
| 002 | Ввести единый реестр агентов | P0 | Done | [002-agent-registry.md](./002-agent-registry.md) |
| 003 | Расширить `agento restore` на все адаптеры | P0 | Done | [003-restore-all-adapters.md](./003-restore-all-adapters.md) |
| 004 | Сделать безопасный backup format с session tracking | P0 | Done | [004-backup-session-format.md](./004-backup-session-format.md) |
| 005 | Вынести launch prepare/cleanup в общий transaction layer | P1 | Backlog | [005-launch-transaction-refactor.md](./005-launch-transaction-refactor.md) |
| 006 | Починить Codex project scope как multi-file transaction | P0 | Backlog | [006-codex-project-multifile-transaction.md](./006-codex-project-multifile-transaction.md) |
| 007 | Валидировать CLI `mode` и `scope` без unsafe casts | P1 | Backlog | [007-cli-mode-scope-validation.md](./007-cli-mode-scope-validation.md) |
| 008 | Добавить доменную валидацию providers/profiles | P1 | Backlog | [008-domain-validation.md](./008-domain-validation.md) |
| 009 | Добавить atomic writes и file permissions для конфигов | P1 | Backlog | [009-atomic-writes-permissions.md](./009-atomic-writes-permissions.md) |
| 010 | Снизить риск хранения API keys в конфигах и backups | P1 | Backlog | [010-secret-handling.md](./010-secret-handling.md) |
| 011 | Реализовать или убрать `independentMode` | P1 | Backlog | [011-independent-mode-semantics.md](./011-independent-mode-semantics.md) |
| 012 | Исправить package export и добавить build smoke | P2 | Backlog | [012-package-export-build-smoke.md](./012-package-export-build-smoke.md) |
| 013 | Расширить integration test coverage | P1 | Backlog | [013-integration-test-coverage.md](./013-integration-test-coverage.md) |
| 014 | Синхронизировать README, README.ru, AGENTS и CHANGELOG | P1 | Backlog | [014-docs-sync.md](./014-docs-sync.md) |

## Процесс выполнения

### 001 - Починить lint и добавить release gate

- [x] Started
- [x] Implementation
- [x] Tests
- [x] Docs
- [x] Done

### 002 - Ввести единый реестр агентов

- [x] Started
- [x] Implementation
- [x] Tests
- [x] Docs
- [x] Done

### 003 - Расширить `agento restore` на все адаптеры

- [x] Started
- [x] Implementation
- [x] Tests
- [x] Docs
- [x] Done

### 004 - Сделать безопасный backup format с session tracking

- [x] Started
- [x] Implementation
- [x] Tests
- [x] Docs
- [x] Done

### 005 - Вынести launch prepare/cleanup в общий transaction layer

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 006 - Починить Codex project scope как multi-file transaction

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 007 - Валидировать CLI `mode` и `scope` без unsafe casts

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 008 - Добавить доменную валидацию providers/profiles

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 009 - Добавить atomic writes и file permissions для конфигов

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 010 - Снизить риск хранения API keys в конфигах и backups

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 011 - Реализовать или убрать `independentMode`

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 012 - Исправить package export и добавить build smoke

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 013 - Расширить integration test coverage

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done

### 014 - Синхронизировать README, README.ru, AGENTS и CHANGELOG

- [ ] Started
- [ ] Implementation
- [ ] Tests
- [ ] Docs
- [ ] Done
