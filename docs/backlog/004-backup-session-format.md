# 004 - Сделать безопасный backup format с session tracking

## Статус

Done

## Приоритет

P0

## Контекст

Backups сейчас пишутся в фиксированный путь `~/.agento/backups/<agent>/<scope>.bak.json`. Повторный запуск того же agent/scope может перезаписать оригинальный backup.

## Проблема

Нет `sessionId`, timestamp, cwd, информации о том, существовал ли исходный файл, и списка затронутых файлов. Это мешает безопасному restore, особенно при repeated independent launch и multi-file адаптерах.

## Цель

Перейти на backup manifest, который точно описывает, что было изменено и как восстановить состояние.

## Scope

- Спроектировать schema backup manifest.
- Добавить `sessionId`, `createdAt`, `agentId`, `scope`, `cwd`.
- Хранить `hadConfig` отдельно от `content`; пустой объект не должен означать "файла не было".
- Поддержать несколько файлов в одном backup: `files: Array<{ path, kind, hadFile, content }>` или аналог.
- Сохранить backward compatibility для чтения legacy backup, если это дешево.
- Обновить `writeBackup`, `readBackup`, `backupExists`, `deleteBackup`, `getBackupPath`.
- Обновить tests.

## Вне scope

- Полная реализация secret redaction. Это задача 010.
- Полный launch transaction refactor. Это задача 005.

## Предлагаемый формат

```ts
interface BackupManifest {
  version: 2;
  sessionId: string;
  agentId: string;
  scope: 'global' | 'project';
  cwd?: string;
  createdAt: string;
  files: Array<{
    path: string;
    format: 'json' | 'toml' | 'yaml' | 'raw' | 'none';
    hadFile: boolean;
    content: unknown;
  }>;
}
```

## Критерии приемки

- Повторный launch не затирает original backup без явного решения.
- Restore может понять, нужно восстановить файл или удалить файл, которого раньше не было.
- `agent status` показывает наличие активного backup корректно.
- Tests покрывают legacy backup и v2 backup.

## Реализация

- Backup хранится как v2 manifest в существующем active path `~/.agento/backups/<agent>/<scope>.bak.json`.
- Manifest содержит `sessionId`, `createdAt`, `agentId`, `scope`, optional `cwd` и `files[]` с `path`, `format`, `hadFile`, `content`.
- Existing active backup не перезаписывается: `writeBackup` бросает ошибку с инструкцией выполнить `agento restore -a <agent> -s <scope>`.
- Legacy raw backup читается и нормализуется в v2-like manifest с одним файлом и `hadFile: true`.
- Restore/cleanup использует `hadFile`: при `true` восстанавливает через `adapter.writeConfig`, при `false` удаляет config path.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Риски

- Нужно аккуратно мигрировать старые backups, чтобы не сломать пользователей.
- Нужно определить политику concurrent launches: запрещать, создавать nested backups или требовать manual restore.
