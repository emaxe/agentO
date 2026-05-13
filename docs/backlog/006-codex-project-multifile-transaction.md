# 006 - Починить Codex project scope как multi-file transaction

## Статус

Backlog

## Приоритет

P0

## Контекст

Codex в project scope пишет `model` в project config, а `model_providers`, `default_profile`, `profiles` в global config. Сейчас backup global config хранится в module-level переменной `codexGlobalBackup`.

## Проблема

Module-level backup теряется при crash/process exit и не интегрирован с `~/.agento/backups`. В результате restore после аварийного independent/child запуска может быть некорректным.

## Цель

Сделать Codex project scope полноценной multi-file transaction, где оба файла участвуют в backup и restore.

## Scope

- Убрать или минимизировать `codexGlobalBackup` как источник истины.
- Описать affected files для Codex project scope:
  - `~/.codex/config.toml`
  - `<cwd>/.codex/config.toml`
- Интегрировать с backup manifest из задачи 004.
- Restore должен восстанавливать оба файла или удалять файлы, которых раньше не было.
- Добавить tests на:
  - global existed/project existed
  - global missing/project missing
  - crash-like restore through CLI backup
  - preserving unrelated global Codex keys

## Вне scope

- Изменение wire API Codex.
- Добавление OpenAI-compatible provider type в Codex, если это не поддерживается продуктово.

## Критерии приемки

- Codex project launch можно безопасно восстановить через CLI после завершения процесса.
- Global Codex config не теряет unrelated keys.
- Если global config отсутствовал до launch, после restore он удаляется или возвращается в исходное отсутствие.
- Нет process-local state, необходимого для restore.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- TOML merge должен быть консервативным: нельзя перезаписать пользовательские секции, не принадлежащие AgentO.
- Нужно ясно определить ownership ключей `model_providers`, `profiles.default`, `default_profile`.

