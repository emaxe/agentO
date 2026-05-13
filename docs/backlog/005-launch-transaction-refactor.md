# 005 - Вынести launch prepare/cleanup в общий transaction layer

## Статус

Done

## Приоритет

P1

## Контекст

`prepareChild` и `launchChild` дублируют один и тот же workflow: read current config, write backup, build config, write config, build env, cleanup. Это повышает риск расхождения CLI и TUI launch.

## Проблема

Дублирование усложняет изменения backup/restore behavior. Любая правка transaction semantics должна быть сделана в нескольких местах.

## Цель

Создать единый transaction layer для подготовки agent config и cleanup.

## Реализация

- `src/launcher/transaction.ts` содержит общий `prepareLaunchTransaction(...)`.
- Transaction выполняет single-file backup в v2 manifest, пишет новый config, собирает `ExecRequest` с очищенным `process.env`, resolved `PATH` и `adapter.buildEnv?.(...)`, а также возвращает cleanup-функцию.
- `prepareChild(...)` и `launchIndependent(...)` стали thin wrappers над transaction.
- `launchChild(...)` использует тот же prepared `ExecRequest`/cleanup result, что и TUI child mode.

## Scope

- Добавить модуль наподобие `src/launcher/transaction.ts`.
- Вынести операции:
  - read current state
  - create backup
  - build agent config
  - write config
  - build env
  - cleanup/restore
- Переписать `prepareChild`, `launchChild`, `launchIndependent` на общий transaction.
- Убрать дублирование env merge и PATH resolve.
- Сохранить public behavior CLI/TUI.

## Вне scope

- Изменение UX independent mode. Это задача 011.
- Новый backup manifest. Это задача 004, но transaction должен быть готов к нему.

## Критерии приемки

- Backup/write/env/cleanup path существует в одном месте.
- `prepareChild` становится тонкой оберткой для TUI.
- `launchChild` использует тот же prepare result, что и TUI.
- Tests покрывают cleanup при existing config и missing config.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- Нужно не сломать signal handling в child mode.
- Нужно гарантировать cleanup при spawn error.
