# 007 - Валидировать CLI `mode` и `scope` без unsafe casts

## Статус

Done

## Приоритет

P1

## Контекст

CLI `launch` сейчас приводит `opts.mode` и `opts.scope` через TypeScript cast. Runtime-валидации нет.

## Проблема

Опечатка вроде `--mode chlid` попадет в ветку `else` и будет обработана как independent mode. Это опасное поведение для команды, которая патчит конфиги.

## Цель

Сделать runtime-валидацию `mode` и `scope` через Commander choices или Zod schemas.

## Scope

- Использовать `LaunchModeSchema` и `LaunchScopeSchema` либо `.choices()`.
- При invalid value выводить понятную ошибку.
- Покрыть тестами invalid mode/scope.
- Проверить TUI settings path, чтобы он продолжал использовать валидные значения.

## Вне scope

- Изменение названий режимов.
- Реализация independentMode semantics. Это задача 011.

## Критерии приемки

- `agento launch --mode invalid` завершается ошибкой до записи конфигов.
- `agento launch --scope invalid` завершается ошибкой до записи конфигов.
- Ошибка содержит список допустимых значений.
- Нет unsafe casts для `mode`/`scope` в launch command.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Ручные проверки:

```bash
node dist/bin/agento.js launch -p default -a qwen --mode invalid
node dist/bin/agento.js launch -p default -a qwen --scope invalid
```

## Риски

- Нужно сохранить fallback на user settings, если option не передан.

