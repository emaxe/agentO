# 001 - Починить lint и добавить release gate

## Статус

Done

## Приоритет

P0

## Контекст

`npm run typecheck` и `npm test` проходят, но `npm run lint` падает на нескольких простых ошибках. При этом `prepublishOnly` сейчас запускает только `npm run build && npm test`, поэтому пакет можно опубликовать с failing lint.

## Проблема

Lint не является обязательным release gate. Это снижает качество релиза и позволяет накапливать мелкий технический долг.

Текущие известные ошибки:

- Unused `vi` в `src/adapters/copilot.test.ts`.
- Unused `writeConfig` в `src/config/store.test.ts`.
- Unused `ProfileModel` в `src/profiles/profile-manager.ts`.
- `no-control-regex` в `src/launcher/shell-path-resolver.ts`.

## Цель

Сделать `npm run lint` зеленым и включить lint в обязательные проверки перед публикацией.

## Scope

- Исправить текущие lint errors без изменения поведения.
- Добавить `npm run lint` в `prepublishOnly`.
- При необходимости добавить точечный eslint-disable только рядом с намеренно используемым control-regex и с пояснением.

## Вне scope

- Массовая смена ESLint версии или миграция на flat config.
- Форматирование всего проекта без необходимости.

## Критерии приемки

- `npm run lint` завершается с кодом 0.
- `npm run typecheck` завершается с кодом 0.
- `npm test` завершается с кодом 0.
- `npm run build` завершается с кодом 0.
- `prepublishOnly` включает lint.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- Не стоит отключать lint rule глобально ради одного regex.
- Не стоит менять поведение `shell-path-resolver`, если задача только hygiene.
