# 009 - Добавить atomic writes и file permissions для конфигов

## Статус

Backlog

## Приоритет

P1

## Контекст

AgentO пишет `~/.agento/config.json`, backups и agent status cache обычным `writeFile`. В config/backups есть API keys.

## Проблема

Обычная запись может оставить частично записанный файл при crash. Также права доступа явно не ограничены.

## Цель

Сделать надежную и приватную запись конфигов AgentO.

## Scope

- Добавить helper `writeJsonAtomic(path, data, options)`.
- Использовать temp file в той же директории и `rename`.
- Для `~/.agento` использовать mode `0700`.
- Для config/backups/status использовать mode `0600`.
- По возможности применить аналогичный helper для JSON agent configs.
- Добавить tests на mode там, где это стабильно работает в Node/Vitest.

## Вне scope

- Полное шифрование секретов. Это задача 010.
- Полная атомарность TOML agent configs, если это требует большой переработки adapters.

## Критерии приемки

- `writeConfig`, `writeBackup`, `writeAgentStatusCache` используют atomic write helper.
- Новые файлы создаются с приватными правами.
- При ошибке записи старый config не повреждается.
- Tests покрывают basic atomic behavior.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- На Windows file mode semantics отличаются. Проект сейчас Node CLI, нужно либо поддержать best effort, либо явно документировать POSIX behavior.
- `rename` может вести себя иначе на разных FS, temp file должен быть в той же директории.

