# Stage D — Фаза 4: жизненный цикл процессов, надёжность ФС, восстановление

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support`. Читай
`docs/windows-support/plan.md` (§3.2, §3.4, §3.6, §6.2–6.3) и `claude-plan.md` (§6, §7).

Сделано: `src/platform/*`, инсталлеры с Windows-ветками, 793 теста зелёные, Windows-CI зелёный,
включая интеграционный тест реального `.cmd`-шима.

## Цель

Сделать запуск агента и восстановление конфига надёжными на Windows и не изменить поведение POSIX,
кроме трёх осознанных улучшений (перечислены ниже).

## 1. Сигналы (`src/launcher/child.ts`)

- Добавить в `ChildLaunchOptions` необязательный `platform?: NodeJS.Platform` (дефолт
  `process.platform`) — для тестов.
- win32-матрица:
  - `SIGINT`: первый — **не убивать** (агент получил тот же `CTRL_C_EVENT` через общую консоль),
    только вывести `Press Ctrl+C again to force quit.`; второй в течение 3 с — `killTree(child,'force')`.
  - `SIGBREAK`, `SIGHUP` — `killTree(child,'force')` и cleanup.
  - таймер grace (5 с) на Windows не ставить.
- POSIX: поведение прежнее (`SIGINT`/`SIGTERM` → `child.kill(signal)`, второй → `SIGKILL`,
  grace-таймер 5 с).
- `settle()` обязан снимать **все** подписанные сигналы (сейчас только SIGTERM/SIGINT).
- `killTree` вызывать из `src/platform/kill-tree.ts` (POSIX-ветка внутри — прежний `child.kill`).

## 2. TUI-путь (`bin/agento.ts`)

Сейчас `spawnAsync` не перехватывает сигналы: Ctrl+C может завершить agento раньше, чем
`run-loop` восстановит конфиг. Минимальное исправление:
- вынести общий помощник `forwardSignals(child, { platform, onFirstInterrupt? })` в
  `src/launcher/signal-forwarding.ts` (или аналогичный файл) и использовать его и в `child.ts`,
  и в `spawnAsync`;
- на POSIX: `SIGINT`/`SIGTERM` → `child.kill(signal)`, второй → `SIGKILL`;
- на win32: первый `SIGINT` игнорировать (агент получил событие сам), второй → `killTree`;
- cleanup конфига остаётся в `run-loop`/`child.ts`, помощник только про процесс.
Не меняй структуру `runTuiLoop` сверх необходимого.

## 3. Файловая система (`src/config/atomic-write.ts`)

- `renameWithRetry(from, to, platform)`: на win32 до 8 попыток при `EPERM/EACCES/EBUSY`,
  backoff 25→400 мс (суммарно ~1 с); на POSIX одна попытка, как сейчас.
- Ретраи для `unlink` в restore-ветке (`src/config/backup-restore.ts` и `store.ts:254,262`) —
  только win32, те же коды; POSIX не меняется.
- Экспортировать `renameWithRetry` для тестов (или тестировать через `writeFileAtomic` с моком `fs/promises`).

## 4. Ключ бэкапа по cwd (`src/config/store.ts`)

`encodeCwdForBackup` — win32-ветка:
- `path.win32.normalize`, `toLowerCase()`, убрать `:` из имени диска;
- заменить зарезервированные имена (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`)
  на `_<name>`;
- обрезать хвостовые точки и пробелы в сегментах;
- если итоговый путь длиннее ~200 символов — заменить хвост на `sha1(cwd).slice(0,16)`.
- **POSIX-ветка не меняется ни на байт** (иначе осиротеют активные бэкапы). Golden-тест:
  фиксированный cwd → прежний массив сегментов.

## 5. Прокси (`src/proxy/anthropic-scrubber.ts`, `openai-proxy.ts`, `responses-proxy.ts`)

- В `stop()`: `server.closeAllConnections?.()` + `server.close()` в `Promise.race` с таймаутом 2 с;
  после таймаута резолвить, не висеть. Cleanup конфига не должен блокироваться.
- Тесты: `stop()` завершается < 2.5 с при открытом keep-alive соединении (можно с реальным сервером
  и `fetch` с `keepAlive`, либо юнит с моком сервера).

## 6. Восстановление после жёсткого kill (`store.ts`, `transaction.ts`)

- В `BackupManifest` добавить необязательные `pid?: number`, `pidStartedAt?: string`.
  `writeBackup` получает pid через `WriteBackupOptions.pid?` (не `process.pid` внутри store — тесты
  должны подставлять своё значение).
- `prepareLaunchTransaction` перед `writeBackup`: если активный бэкап существует и в манифесте есть
  `pid`, проверить `process.kill(pid, 0)`:
  - `ESRCH` → бэкап устарел: восстановить его (`restoreBackupManifest`), добавить предупреждение
    `Recovered config from a previous crashed session` и продолжить запуск;
  - процесс жив или pid нет в манифесте → прежняя ошибка `Active backup already exists...`.
- Ограничение: переиспользование pid. Защита — только «pid мёртв»; при живом pid всегда ошибка.
- Тесты: stale pid → авто-restore + предупреждение; живой pid → ошибка; старый манифест без pid →
  ошибка (обратная совместимость).
- На POSIX это меняет поведение только для бэкапов, созданных **после** обновления (в них появится pid).
  Это осознанное улучшение; отметь в отчёте.

## 7. Тесты

- `child.test.ts`: матрица win32 (первый SIGINT игнор, второй → killTree; SIGBREAK/SIGHUP → killTree
  + cleanup ровно один раз; ENOENT → cleanup + код 1) и POSIX (SIGINT → child.kill, второй → SIGKILL).
  Фейковый ChildProcess + инъекция `platform`; `killTree` замокать.
- `kill-tree.test.ts`: POSIX-ветка; win32 — интеграционный `taskkill` тест с `skipIf(!win32)`
  (спавн `cmd /c ping -n 30 127.0.0.1 > nul`, затем killTree, проверить, что pid мёртв).
- `atomic-write.test.ts`: ретраи на `EPERM` (мок `rename`: 2 ошибки, затем успех), не ретраит `ENOENT`,
  POSIX = 1 попытка, tmp удаляется при финальной ошибке.
- `store.test.ts`: win32-ключ бэкапа (`C:\Proj` = `c:\proj`, `CON`, длинный путь → хеш), POSIX golden.
- `backup-recovery.test.ts`: stale pid / живой pid / без pid.
- Прокси: `stop()` с таймаутом.

## 8. Проверки

```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
```
Зелёные на Linux; тестов ≥ 793. POSIX-поведение подтверждено существующими тестами (число
не уменьшилось), новые win32-тесты выполнятся в CI.

## 9. Отчёт

```
STAGE_D_DONE
tests: <passed>/<skipped>/<total>
files: <изменённые/созданные>
notes: <что проверено только юнит-тестами / что требует ручной Windows>
```
Продублируй в `docs/windows-support/runs/stageD-report.md`. Отдельно перечисли осознанные изменения
поведения на POSIX (ожидаются: авто-restore по мёртвому pid, закрытие keep-alive в proxy stop) и
подтверждение, что `encodeCwdForBackup` на POSIX не изменился.

## Границы
- Не коммить и не пушь.
- Не трогать TUI-рендеринг/вставку/ЙЦУКЕН (Stage E), CI и документацию (Stage F), installers.
