# 014 - Синхронизировать README, README.ru, AGENTS и CHANGELOG

## Статус

Backlog

## Приоритет

P1

## Контекст

Проект уже содержит `copilot` и `goose`, но часть документации и AGENTS.md местами отражает старую структуру или старые ограничения. Также restore behavior и independent mode описаны не полностью в соответствии с кодом.

## Проблема

Документация может вводить пользователя и разработчика в заблуждение. Для этого проекта это особенно важно, потому что глобальный `agento` запускает `dist`, а contributors должны понимать build/release flow.

## Цель

Привести README, README.ru, AGENTS.md и CHANGELOG в соответствие с текущим кодом и завершенными backlog-задачами.

## Scope

- Обновить список агентов и provider compatibility.
- Обновить описание `restore` после задачи 003.
- Обновить backup/restore semantics после задач 004-006.
- Обновить independent mode docs после задачи 011.
- Обновить release checklist после задачи 001 и 012.
- Добавлять записи в `[Unreleased]` CHANGELOG для каждой пользовательски видимой правки.

## Вне scope

- Полный rewrite README.
- Маркетинговые тексты.

## Критерии приемки

- README и README.ru не противоречат CLI help.
- AGENTS.md содержит актуальную структуру проекта.
- CHANGELOG `[Unreleased]` отражает сделанные изменения.
- Документация явно напоминает про `npm run build` после изменений `src/` или `bin/`.

## Проверки

```bash
npm run build
node dist/bin/agento.js --help
node dist/bin/agento.js launch --help
node dist/bin/agento.js restore --help
```

## Риски

- Docs могут отстать снова, если не включить docs update в definition of done.

