# Stage B — Фаза 2: слой `src/platform/*` и перевод запусков

Работаешь в `~/projects/personal/agentO`, ветка `feature/windows-support`. Читай
`docs/windows-support/plan.md` (§3.1, §3.2, §3.5, §3.9) и при необходимости эскизы в
`docs/windows-support/claude-plan.md` (§3.3).

Stage A уже сделан: `.gitattributes`, `cross-spawn@^7.0.6`, `@types/cross-spawn`, тестовые хелперы,
693 теста зелёные на Linux, windows-job в CI зелёный.

## Цель

Создать тонкий платформенный слой и перевести на него **все** запуски процессов. Поведение на POSIX
не меняется (кроме исправления дублей `Path`/`PATH`). Никаких изменений сигналов, инсталлеров по
смыслу, TUI и документации — это следующие стадии.

## Что создать

### `src/platform/env.ts`
- `getEnvCI(env, name, platform = process.platform): string | undefined` — на win32 ищет ключ
  без учёта регистра (`Path`/`PATH`), на POSIX — точное имя.
- `setEnvCI(env, name, value, platform = process.platform): void` — на win32 заменяет существующий
  ключ, сохраняя его написание, и удаляет дубли других регистров; на POSIX — `env[name] = value`.
- `cleanEnv(env)` при необходимости — не добавляй лишнего API.

### `src/platform/resolve-executable.ts`
Чистая логика + ФС-проверка, разделённые для тестируемости на Linux:
- `candidatePaths(cmd, env, platform, pathApi): string[]` — порядок:
  - если `cmd` содержит разделитель или абсолютный — только он (с расширениями из PATHEXT);
  - иначе каталоги из `getEnvCI(env,'PATH')`, разделитель `;` на win32 и `:` на POSIX;
  - расширения: если у `cmd` уже есть расширение — сначала как есть, затем PATHEXT;
    иначе PATHEXT (дефолт `.COM;.EXE;.BAT;.CMD`) в указанном порядке; на POSIX расширений нет.
  - снимать кавычки вокруг элементов PATH (`"C:\Program Files\nodejs"`).
- `resolveExecutable(cmd, env, platform, deps?)` — первый существующий файл (`existsSync`),
  возвращает `{ path, kind: 'native' | 'shim' }` (`native` для `.exe`/`.com`, `shim` для `.cmd`/`.bat`),
  либо `null`. `deps` для инъекции `existsSync` в тестах.
- POSIX: `resolveExecutable` не обязана искать — верни `null` и не меняй поведение (spawn сам найдёт
  по PATH). Не добавляй проверку `+x`.

### `src/platform/spawn.ts`
- `spawnCommand(cmd, args, opts?)` → `crossSpawn(cmd, args, { shell: false, ...opts })`.
- `spawnCommandSync(cmd, args, opts?)` → `crossSpawn.sync(...)`.
- На win32 перед вызовом: `resolveExecutable` по `opts.env ?? process.env`; если `null` — вернуть/бросить
  ошибку с `code: 'ENOENT'` и сообщением `spawn <cmd> ENOENT` (сохраняет контракт `isEnoent()`).
  Для sync — объект с `error.code='ENOENT'` и `status=null`, как у `spawnSync`.
- На POSIX **не** вызывать `resolveExecutable` (никаких изменений семантики).
- Проброс `stdio`, `env`, `cwd`, `windowsHide`, `timeout` без потерь. Не добавляй `shell:true` никогда.

### `src/platform/kill-tree.ts`
- `killTree(child, mode, platform = process.platform)`:
  - POSIX — `child.kill(mode === 'force' ? 'SIGKILL' : mode)`;
  - win32 — `spawnCommand('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio:'ignore', windowsHide:true })`,
    фолбэк `child.kill()` при ошибке.
- Пока **не подключай** к `child.ts` — только модуль + тест (POSIX-ветка).

## Что изменить

1. `bin/agento.ts` — `spawn` → `spawnCommand`; передать `cwd: process.cwd()`.
2. `src/launcher/child.ts` — `spawn` → `spawnCommand`; логику сигналов не трогать.
3. `src/cli/commands/launch.ts` — `spawnSync` → `spawnCommandSync`; логику кодов возврата не менять
   (это Stage D).
4. `src/installers/{npm,copilot,goose,kimi}.ts` — все `spawn`/`spawnSync` → обёртки. Каналы установки
   (winget/uv/manual) **не менять** — только способ запуска.
5. `src/launcher/transaction.ts` — заменить `{ ...cleanProcessEnv(), PATH: resolvedPath, ...adapterEnv }`
   на сборку через `setEnvCI` (сначала PATH, затем adapterEnv, чтобы адаптер мог переопределить),
   и в `withNoProxyLoopback` читать/писать `NO_PROXY`/`no_proxy` через `getEnvCI`/`setEnvCI`.
   На POSIX результат должен быть идентичен прежнему.
6. ESLint: запретить `node:child_process` вне `src/platform/**` и тестов
   (`no-restricted-imports` с `patterns`). Разрешить только `src/launcher/shell-path-resolver.ts`
   (POSIX login-shell probe) — добавь комментарий почему.

## Тесты (обязательно)

- `src/platform/env.test.ts`: win32 `Path`+`PATH` → после `setEnvCI` ровно один ключ; POSIX не меняется;
  `getEnvCI` находит `Path` по имени `PATH`.
- `src/platform/resolve-executable.test.ts`: PATHEXT-порядок, команда с расширением, абсолютный путь,
  кавычки в PATH, `Path` vs `PATH`, пустой PATH, POSIX возвращает `null`; `candidatePaths` — чистая
  функция, проверяется на Linux с `path.win32`/`path.posix`.
- `src/platform/spawn.test.ts`: на POSIX обёртка запускает `process.execPath -e "..."` и возвращает
  тот же код/вывод; аргументы с пробелами и `&` доходят буквально; при отсутствующей команде
  `error.code === 'ENOENT'` (POSIX и win32-ветка через мок `resolveExecutable`).
- `src/platform/kill-tree.test.ts`: POSIX-ветка вызывает `child.kill` с нужным сигналом (фейковый
  ChildProcess).
- `src/launcher/transaction.test.ts` — расширить: win32-ветка не оставляет двух ключей PATH
  (если это тестируется без запуска Windows — инъекцией платформы; если нет, отметь в отчёте).

## Проверки

```
npm test
npm run typecheck
npm run lint
npm run build
node dist/bin/agento.js --version
```
Всё зелёное на Linux, число тестов ≥ 693. POSIX-поведение не должно измениться ни в одном
существующем тесте.

## Отчёт

В stdout:
```
STAGE_B_DONE
tests: <passed>/<skipped>/<total>
files: <изменённые/созданные>
notes: <что не проверено / отклонения>
```
и продублируй в `docs/windows-support/runs/stageB-report.md`. Отдельно перечисли, какие вызовы
заменены и какие прямые импорты `node:child_process` остались (должен остаться только
`src/launcher/shell-path-resolver.ts` и тесты).

## Границы
- Не коммить и не пушь.
- Не менять сигналы в `child.ts`, не унифицировать TUI-путь, не трогать installers по смыслу,
  не править README/AGENTS.md/CI.
- Windows-поведение локально не проверить: помечай «проверить в CI».
