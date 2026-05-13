# 011 - Реализовать или убрать `independentMode`

## Статус

Backlog

## Приоритет

P1

## Контекст

В schema есть `independentMode: 'spawn-detached' | 'pty'`, но фактический CLI launch для independent mode использует `spawnSync` и ждет процесс. TUI description говорит про detached/log semantics, которые не реализованы.

## Проблема

Настройка вводит пользователя в заблуждение. Поведение independent mode не соответствует описанию и названию `spawn-detached`.

## Цель

Принять и реализовать одно из двух решений:

- Реально реализовать `spawn-detached` и `pty`.
- Или убрать `independentMode` до появления полноценной реализации.

## Scope

- Зафиксировать ожидаемые semantics independent mode.
- Если реализуем:
  - `spawn-detached`: detached child, log file, PID info, restore responsibility documented;
  - `pty`: использовать optional `node-pty`, graceful fallback если dependency недоступна;
  - TUI/CLI должны использовать setting.
- Если убираем:
  - удалить setting из schema/TUI/docs;
  - миграция старого config должна игнорировать поле.
- Добавить tests на выбранную стратегию.

## Вне scope

- Полный process manager для detached agents.
- Автоматический restore detached процесса после exit, если нет надежного hook.

## Критерии приемки

- Документация соответствует фактическому поведению.
- `independentMode` либо реально влияет на запуск, либо отсутствует.
- Нет misleading текста про log file/survives exit, если это не реализовано.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- Detached process усложняет restore и UX.
- `node-pty` optional dependency может быть недоступна на части систем.

