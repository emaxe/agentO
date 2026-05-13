# 006 - Починить Codex project scope как multi-file transaction

## Статус

Done

## Приоритет

P0

## Контекст

Codex в project scope пишет `model` в project config, а `model_providers`, `default_profile`, `profiles` в global config. Сейчас backup global config хранится в module-level переменной `codexGlobalBackup`.

## Проблема

Module-level backup теряется при crash/process exit и не интегрирован с `~/.agento/backups`. В результате restore после аварийного independent/child запуска может быть некорректным.

## Цель

Сделать Codex project scope полноценной multi-file transaction, где оба файла участвуют в backup и restore.

## Итоговый дизайн

- `AgentAdapter` получил optional hooks:
  - `snapshotConfigFiles(scope, cwd?)` — описывает все физические файлы, которые должен сохранить launch transaction.
  - `restoreConfigFile(file, scope, cwd?)` — восстанавливает или удаляет конкретный файл из backup manifest.
- Для адаптеров без hooks transaction behavior остался single-file: `readConfig` → `writeBackup` → `buildConfig` → `writeConfig`, restore через `writeConfig` или удаление основного config path.
- Codex реализует hooks для `project` scope: manifest содержит global `~/.codex/config.toml` и project `<cwd>/.codex/config.toml`.
- Codex project `writeConfig` больше не использует process-local `codexGlobalBackup`; global TOML merge сохраняет unrelated keys и обновляет только AgentO-owned keys `model_providers`, `default_profile`, `profiles`.
- Cleanup и CLI restore используют общий `restoreBackupManifest(...)`, поэтому crash-like restore восстанавливает оба Codex файла из `~/.agento/backups/codex/project.bak.json`.

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
