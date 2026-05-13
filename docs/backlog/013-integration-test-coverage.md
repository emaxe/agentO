# 013 - Расширить integration test coverage

## Статус

Done

## Приоритет

P1

## Контекст

Unit tests хорошо покрывают adapters и managers, но мало end-to-end проверок CLI flows: restore, invalid options, repeated launch, Codex multi-file behavior.

## Проблема

Критичные сценарии управления пользовательскими конфигами могут регрессировать без падения текущих тестов.

## Цель

Добавить integration tests для CLI/launcher/config flows, особенно вокруг backup/restore.

## Scope

- Добавить тестовый harness с временным HOME и cwd.
- Покрыть:
  - `agento restore` для всех adapters;
  - invalid `--mode` и `--scope`;
  - profile с missing provider;
  - repeated independent launch не затирает original backup;
  - Codex project scope restores global и project files;
  - build smoke на dist CLI.
- Использовать child process для CLI smoke tests там, где это оправдано.

## Вне scope

- Интерактивные TUI golden tests.
- Реальный запуск внешних agent binaries.

## Критерии приемки

- Новые tests воспроизводят текущие риски.
- Tests не зависят от реального home config пользователя.
- Tests стабильны на CI и локально.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- CLI tests через child process могут быть медленнее.
- Нужно изолировать env, PATH и HOME, чтобы не трогать реальные конфиги.

