# 012 - Исправить package export и добавить build smoke

## Статус

Backlog

## Приоритет

P2

## Контекст

`package.json` указывает `main` и `exports` на `./dist/index.js`, но в проекте нет `src/index.ts`, значит после build нет `dist/index.js`. CLI entrypoint при этом есть: `dist/bin/agento.js`.

## Проблема

Пакет может быть некорректен как library import. Пользователь, импортирующий package, получит missing export.

## Цель

Либо сделать пакет CLI-only, либо добавить корректный public API entrypoint.

## Scope

- Решить product intent:
  - CLI-only: убрать `main`/`exports`;
  - library + CLI: добавить `src/index.ts` с стабильными exports.
- Добавить build smoke script, например:
  - `node dist/bin/agento.js --version`
  - `node -e "import('@emaxe/agento')"` только если library API сохраняется.
- Включить smoke в release gate.

## Вне scope

- Большой public API design, если пакет пока CLI-only.

## Критерии приемки

- После `npm run build` все paths из `package.json` существуют.
- `node dist/bin/agento.js --version` работает.
- `npm pack --dry-run` показывает ожидаемые файлы.

## Проверки

```bash
npm run build
node dist/bin/agento.js --version
npm pack --dry-run
```

## Риски

- Удаление `exports` может быть breaking change для тех, кто уже импортирует пакет, даже если import сейчас фактически сломан.

