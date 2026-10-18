# AgentO: план полной поддержки Windows

> Сводный план. База: `main` @ `423b00f` (v0.9.0). Составлен по двум независимым планам
> (`claude-plan.md`, `agy-plan.md`) с проверкой фактов на этой машине и в CI GitHub.
> Код не менялся. Все утверждения о поведении Windows, которые нельзя проверить на Linux,
> помечены **ПРОВЕРИТЬ** и сведены в §9.

## 1. Цель и границы

**Цель:** `npm i -g @emaxe/agento` на Windows 10 1809+/11 (Windows Terminal и conhost, PowerShell и cmd)
даёт паритет с macOS/Linux: TUI, `agento launch` (child/independent), `restore`, детект установленности,
установка/обновление агентов там, где есть надёжный неинтерактивный канал, гарантированное
восстановление конфига.

**Входит:** 9 агентов (claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi), proxy-слой,
store/backup, тесты, CI, документация.

**Не входит:**
- WSL — это Linux-путь, уже работает; упомянуть в доках как альтернативу.
- Windows 7/8, Node < 18.20.2.
- Шифрование API-ключей (DPAPI/Credential Manager) — агенты читают plaintext сами.
- `.ps1`-only шимы при `Restricted/AllSigned` ExecutionPolicy.
- Нативный MSI/GUI-инсталлятор.

**Инвариант:** поведение на POSIX не меняется. Все развилки — через тонкий слой `src/platform/*`
с инъекцией `platform` (по образцу `ShellPathResolverOptions.platform`, `shell-path-resolver.ts:44`).

## 2. Что подтверждено фактами

| Факт | Доказательство |
|---|---|
| Запуск/установка ломаются на Windows | `spawn(..., {shell:false})`: `bin/agento.ts:41`, `child.ts:55`, `launch.ts:125`, `installers/npm.ts:55,83,111`, `copilot.ts:56`, `goose.ts:56`, `kimi.ts:62,90`; команды в `src/agents/registry.ts` без расширения |
| `.cmd` не запускается без `cmd.exe` | libuv `src/win/process.c`: «CreateProcess can start only .com and .exe files»; Node docs «Spawning .bat and .cmd files on Windows»; Node ≥ 18.20.2 отклоняет `spawn('x.cmd')` без shell (`EINVAL`, CVE-2024-27980) |
| Windows-job в CI красный, но не блокирует | run `34360105236`: `windows-latest / node 20` — failure на шаге Test; `continue-on-error: true` (`ci.yml:23-31`) |
| Падают ровно 10 тестов | 5×`configPaths` (claude-code, codex, copilot, goose, qwen) из-за POSIX-литералов; 5×`shell-path-resolver` (POSIX-сценарии на win32-хосте) |
| Пакет `opencode` не существует | `npm view opencode` → 404; `opencode-ai` → 1.19.3. `src/installers/opencode.ts:7` содержит `packageName: 'opencode'` — **баг на всех ОС**, не только Windows |
| `@github/copilot` существует | `npm view` → 1.0.98 |
| `cross-spawn` актуален и безопасен | latest 7.0.6, зависимости `which`, `path-key`, `shebang-command`; CVE-2024-21538/48910 закрыты в 7.0.6 |
| Отчёт по Windows потерян из-за `.gitignore` | `.gitignore:6` — `docs/*`; `docs/windows-cross-platform-report.md` никогда не коммитился |
| Заглавные буквы ЙЦУКЕН не маппятся | `src/tui/use-key-input.ts:4` — «lowercase only»; Shift+Н даёт `Н`, подтверждение `y` не срабатывает. Баг общий, не Windows-специфичный |

## 3. Ключевые решения

### 3.1. Запуск агентов: cross-spawn + собственный предрезолвер

- Добавить `cross-spawn@^7.0.6` (+ `@types/cross-spawn`) и обернуть в `src/platform/spawn.ts`
  (`spawnCommand`, `spawnCommandSync`). Все прямые `node:child_process`-вызовы заменяются на обёртку;
  ESLint-правило `no-restricted-imports` запрещает `node:child_process` вне `src/platform` и тестов.
- Собственный `src/platform/resolve-executable.ts` (25–40 строк чистой логики) вызывается **до** spawn:
  ищет команду по `PATH`/`PATHEXT` из **того env, с которым будет запуск**, возвращает путь и тип.
  Это сохраняет контракт `isEnoent()` (`run-loop.ts:19`): при `null` агент сам эмитит `ENOENT`, а не
  получает `exit 1` от `cmd.exe /c`.
- `.exe`/`.com` — запускать напрямую (`shell:false`, прямой PID). `.cmd`/`.bat` — через `cmd.exe`
  (это делает cross-spawn).
- **Почему не `shell:true`:** конкатенация `command + args` без экранирования (инъекции, пробелы),
  DEP0190 в Node 24, потеря ENOENT.
- **Почему не свой экранировщик `cmd.exe`:** экранирование `& | < > ^ % !` с двойным разбором
  `.cmd`-шимов — security-чувствительная область (BatBadBut); писать заново ради одной зависимости
  плохая сделка. Обёртка позволяет заменить cross-spawn на свой резолвер без правки вызовов.
- `windowsHide: true` — только для служебных процессов (`taskkill`, `where`, `reg`, `npm --version`),
  не для самого агента (`stdio:'inherit'`).

### 3.2. Жизненный цикл процессов

- `src/platform/kill-tree.ts`: POSIX — `child.kill(signal)`; win32 — `taskkill /PID <pid> /T /F`,
  фолбэк `child.kill()`. **Не** использовать `process.kill(-pid)` — процессы не запускаются
  в отдельной группе, вызов убил бы сам agento.
- `child.ts`: на win32 подписки `SIGINT`, `SIGBREAK`, `SIGHUP`. Первый Ctrl+C игнорируется (агент
  получил тот же `CTRL_C_EVENT` через общую консоль); второй в течение 3 с → tree kill. `SIGHUP`
  (закрытие окна) и `SIGBREAK` → tree kill + cleanup. `settle()` вызывает cleanup ровно один раз.
- Унифицировать TUI-путь и `launchChild`: вынести `runChildProcess(execReq, {cwd, platform})`,
  использовать в `bin/agento.ts` и `child.ts`. Сейчас TUI-путь не перехватывает сигналы и может
  завершиться по SIGINT раньше cleanup.
- Independent (`launch.ts:125`): вернуть реальный код, обработать `error` (ENOENT → сообщение,
  exit 127), передать `cwd`.
- Отложенное восстановление после hard-kill (Task Manager, BSOD): в манифест бэкапа добавить
  необязательные `pid`, `pidStartedAt`; при следующем launch, если pid мёртв — авто-restore
  с предупреждением. Обратная совместимость сохраняется.

### 3.3. Окружение и PATH

- `src/platform/env.ts`: `getEnvCI`/`setEnvCI` — поиск и запись переменных без учёта регистра,
  ровно один ключ `PATH` (устраняет пару `Path`+`PATH` из `transaction.ts:73`).
- `shell-path-resolver.ts`: сохранить win32-ветку (`;`, без login-shell, `Path`/`PATH`), дополнить
  фолбэк-каталогами (только если существуют): `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`,
  `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.cargo\bin`,
  `%USERPROFILE%\scoop\shims`, `%ProgramFiles%\nodejs`.
- После установки агента — `shellPathResolver.invalidate()`; опционально перечитывать PATH из
  реестра (`reg query HKCU\Environment` / HKLM, REG_EXPAND_SZ) — иначе новый агент не виден до
  перезапуска терминала.
- `codex.ts:59,86`: `process.env.HOME ?? homedir()` → `homedir()` (+ приоритет `CODEX_HOME`).
- **Пути конфигов на Windows** — отдельная подзадача Ф3: проверить для каждого из 9 агентов, откуда
  он реально читает конфиг (goose — `%APPDATA%`, kimi — `.env`, kilo/pi — свои каталоги). Ошибка здесь
  даёт «агент запустился, но конфиг не применился» — худший класс дефектов. Результат — таблица
  в `docs/windows-support/report.md` с пометкой «проверено / по документации».

### 3.4. Файловая система

- `atomic-write.ts`: `renameWithRetry` для `EPERM/EACCES/EBUSY` (8 попыток, backoff до ~1 с) только
  на win32; те же ретраи для `unlink` в restore-ветке.
- `encodeCwdForBackup` (`store.ts:18`): на win32 — `path.win32.normalize`, `toLowerCase()`, убрать `:`,
  защита зарезервированных имён (`CON`, `NUL`, `COM1`…), обрезка хвостовых точек/пробелов,
  при длине > ~200 символов — хвост `sha1(cwd).slice(0,16)`. На POSIX раскладка не меняется.
- Права: `mode 0o600` на Windows — no-op. DPAPI не применяем (агенты читают plaintext). ACL через
  `icacls` — опционально (P2) только для `~/.agento/**`; для project-scope — предупреждение.
- Длинные пути: не добавлять `\\?\` (ломает `relative`/git), избегать длинных путей самим, ловить
  `ENAMETOOLONG` и подсказывать `LongPathsEnabled`.
- Кодировки: все конфиги UTF-8 без BOM, `\n`; `.gitattributes` — `* text=auto eol=lf`,
  `*.cmd text eol=crlf`.

### 3.5. Установка и детект

- `checkInstalled`: через `spawnCommandSync`/async, `timeout 10s`, env с resolved PATH; различать
  `not-found` / `failed` / `timeout` (необязательное поле `reason`); 9 агентов проверять параллельно
  (последовательный `cmd.exe`-старт блокирует Ink).
- `npm.ts`: один `runNpm(args)` вместо трёх копий; после успеха — `invalidate()`; распознавать
  `EPERM/EACCES` и подсказывать `npm config set prefix %APPDATA%\npm`.
- `opencode`: исправить `packageName` на `opencode-ai` (проверено) — отдельный баг вне Windows.
- `copilot`: win32 — цепочка winget (`GitHub.Copilot`) → npm (`@github/copilot`) → manual; brew
  оставить только на darwin.
- `goose`: win32 — **manual only** (или winget `Block.Goose` после проверки id); никакого brew.
- `kimi`: win32 — `uv tool install --python 3.13 kimi-cli` при наличии `uv`, иначе `pip install
  kimi-cli` / manual; `bash`+`curl` на win32 не вызывать никогда.
- Точные имена пакетов и winget-id — проверить `npm view`/`winget search` до кодирования.

### 3.6. TUI и прокси

- `isTTY`-guard в `bin/agento.ts`: без терминала — сообщение и `exit 2` (вместо стектрейса Ink).
- ЙЦУКЕН: маппить заглавные (`Й→Q`, `Н→Y`, `Т→N`, …) или `RU_TO_EN[input.toLowerCase()]`
  с сохранением регистра. Проверить подтверждения `y/n` на русской раскладке.
- Вставка: отбрасывать `\r`/`\n` в `TextField` (Windows Terminal может прислать `\r` как submit).
- `stdin.pause()` перед spawn: проверить потерю первого символа; при воспроизведении —
  `setRawMode(false)` + `unref()` до спавна.
- conhost: при отсутствии `WT_SESSION`/`TERM_PROGRAM` — ASCII-рамки (`borderStyle: 'classic'`).
- Прокси: `server.closeAllConnections?.()` + таймаут 2 с в `stop()`, чтобы cleanup не зависал;
  биндинг остаётся `127.0.0.1`; мапить `EACCES/EADDRINUSE` в читаемую ошибку.

### 3.7. CI и документация

- `windows-latest` — Node 20 и 22, **блокирующий** (`continue-on-error` убрать), branch protection.
- `defaults.run.shell: bash` для единого синтаксиса + отдельные шаги `pwsh` и `cmd` (глобальный
  `agento.cmd` после `npm i -g` — самый ценный сигнал).
- `timeout-minutes: 15`, junit-артефакт при падении, `npm ci` кэш.
- Документация: README (EN/RU), AGENTS.md (`src/platform/*`, запрет прямого `child_process`,
  «тесты без POSIX-литералов»), CHANGELOG, `docs/windows-support/report.md`; заменить битую ссылку
  на `docs/windows-cross-platform-report.md`; `.gitignore` — разрешить `docs/windows-support/**`,
  но игнорировать `docs/windows-support/runs/`.

### 3.8. Найденный попутно баг (вне Windows)

`src/installers/opencode.ts:7` — `packageName: 'opencode'`, такого пакета в npm нет (404).
Правильный — `opencode-ai`. Установка OpenCode через визард не работает ни на одной ОС.
Исправить в Ф3 и покрыть тестом.

### 3.9. Гарантии неизменности macOS/Linux

Инвариант «POSIX не меняется» обеспечивается конструкцией, а не обещанием:

- **cross-spawn на POSIX — прозрачный passthrough.** Проверено по исходнику 7.0.6: `parseNonShell()`
  при `process.platform !== 'win32'` возвращает аргументы без изменений, дальше вызывается штатный
  `child_process.spawn`; поиск по PATH, `cmd.exe` и экранирование включаются только на Windows.
- **Все развилки — по параметру `platform`**, а не по глобальному `process.platform` в глубине кода.
  POSIX-ветки остаются прежними: `child.kill(signal)`, без ретраев `rename`, без win32-фолбэков PATH,
  прежняя раскладка `~/.agento/backups/<agent>/<scope>/<cwd…>`.
- **Никаких глобальных нормализаций путей.** `encodeCwdForBackup` меняется только под win32 —
  иначе осиротеют активные бэкапы и `restore` перестанет их находить. Нужен golden-тест: фиксированный
  cwd → прежний путь на POSIX.
- **Тесты не ослабляем.** Нельзя заменять все POSIX-ожидания на `path.join(...)`: это скроет баг,
  когда код пишет `\` на POSIX или `/` на Windows. Схема: явные POSIX-golden-ожидания + отдельные
  тесты win32-ветки с инъекцией `platform`/`path.win32`.
- **`.gitattributes`** (`* text=auto eol=lf`) не меняет рабочее дерево: CRLF-файлов в репозитории
  сейчас нет (проверено `git grep -Il $'\r'` → 0). На Linux/macOS поведение checkout прежнее.
- **CI** добавляет job, но не трогает ubuntu/macos-матрицу; их результаты остаются блокирующими.

Четыре изменения **затрагивают POSIX** (их нельзя мержить без отдельного прогона на macOS/Linux):

1. **Исправление `opencode` → `opencode-ai`** — установка OpenCode на macOS/Linux сейчас не работает;
   после правки обязателен ручной прогон `install/update/uninstall`.
2. **Унификация TUI-пути через `runChildProcess`** — на POSIX TUI начнёт перехватывать сигналы и
   восстанавливать конфиг (сейчас может выйти по SIGINT раньше cleanup). Меняет UX Ctrl+C: проверить,
   что агент получает сигнал, конфиг восстанавливается один раз, повторный запуск не падает на
   «Active backup».
3. **Авто-restore по мёртвому pid** — меняет поведение при stale-бэкапе с ошибки на восстановление.
   Защита: только если pid не существует; при живом pid — прежняя ошибка. Тесты на POSIX обязательны.
4. **`closeAllConnections()` в `stop()` прокси** — на POSIX принудительно закрывает keep-alive
   соединения; это ускоряет cleanup, но должно быть покрыто тестами прокси.

Всё остальное (spawn-обёртка, env, kill-tree, installers, TUI-фиксы, документация) на POSIX либо
не исполняется, либо является исправлением уже сломанного поведения.

## 4. Фазы

Оценка — человеко-дни, один разработчик с доступом к Windows 11 (VM достаточно). Без живой Windows
Ф2/Ф5/Ф6 растягиваются примерно на +50% из-за цикла «push → CI».

| Фаза | Содержание | Зависит | Оценка |
|---|---|---|---|
| **0. Диагностика** | точный список 10 падений (junit-артефакт), `.gitattributes`, `.gitignore` (разрешить `docs/windows-support/**`, игнорировать `runs/`), `cross-spawn` + типы, фикстуры фейковых агентов | — | 0.5 |
| **1. Тесты без POSIX-литералов** | `src/test-utils/paths.ts`, `path.join`/`path.win32`, мок `homedir`, `skipIf`, инъекция платформы в `ShellPathResolver`-тестах; windows-job пока `continue-on-error` | 0 | 1.5 |
| **2. Слой `src/platform/*` и запуск** | `spawn.ts`, `resolve-executable.ts`, `env.ts`, `kill-tree.ts`, `runChildProcess`; замена всех вызовов в `child.ts`, `bin/agento.ts`, `launch.ts`, `transaction.ts`; ESLint-запрет | 1 | 3 |
| **3. Установка, детект, пути конфигов** | installers (npm/copilot/goose/kimi/opencode), `checkInstalled` async + `reason`, PATH-фолбэк/refresh, `codex→homedir()`, проверка путей конфигов 9 агентов | 2 | 3.5 |
| **4. Надёжность** | сигнал-матрица, `taskkill /T /F`, ретраи `atomic-write`/`unlink`, `encodeCwdForBackup`, `closeAllConnections`, авто-restore после crash, `isTTY`-guard | 2 | 3 |
| **5. TUI** | ручная приёмка WT/conhost × PowerShell/cmd, вставка, `stdin.pause`, ASCII-рамки, заглавный ЙЦУКЕН | 2, 3 | 2 |
| **6. CI и документация** | блокирующий windows job 20/22, pwsh/cmd smoke, README EN/RU, AGENTS.md, CHANGELOG, report.md, битая ссылка; опционально ACL/ConPTY-e2e | 1–5 | 2 (+1.5) |
| **Итого** | | | **≈ 15.5 (+3.5 опц.)** |

### Критерии приёмки по фазам

- **Ф0:** `git ls-files docs/windows-support` содержит план/отчёт; `git check-ignore -v docs/windows-support/runs/x` игнорируется; junit с 10 падениями приложен.
- **Ф1:** `npm test` на windows-latest Node 20/22 — 0 падений; на ubuntu/macos число тестов не уменьшилось; `grep -rnE "'/(my|tmp|home)[^']*'" src --include=*.test.ts` не находит литералов в `expect`.
- **Ф2:** на windows-latest фейковый `fake-agent.cmd` в каталоге с пробелом и кириллицей в `cwd` запускается, получает аргументы буквально, возвращает 7 → `launchChild` = 7; несуществующая команда → `ENOENT`, не exit 1; `node:child_process` вне `src/platform`/тестов — 0; POSIX golden-тест зелёный.
- **Ф3:** после установки пакета с `bin` `checkInstalled` → `installed:true, version`; без него → `reason:'not-found'`; goose на win32 → manual без `brew`; kimi без `uv` → manual; таблица путей конфигов заполнена.
- **Ф4:** тест kill-tree (оба процесса мертвы), SIGINT-матрица, `renameWithRetry`, симуляция crash → авто-restore, `agento` без TTY → exit 2; 100 последовательных `writeFileAtomic` без ошибок.
- **Ф5:** ручной чек-лист §8 пройден в WT + conhost, PowerShell + cmd, без блокирующих дефектов; заметки в report.md.
- **Ф6:** все три ОС блокирующие и зелёные; POSIX-regression gate пройден (macOS и Linux: `npm test`, `launch` child, `restore` по бэкапу, созданному до обновления, установка OpenCode); PR с намеренной поломкой win32-ветки краснеет; `agento --version` в pwsh и cmd; README не содержит «not supported»; ссылки резолвятся.

## 5. Правки по файлам

| Файл | Изменение |
|---|---|
| `src/platform/spawn.ts` (новый) | обёртка cross-spawn, единственная точка запуска |
| `src/platform/resolve-executable.ts` (новый) | PATHEXT/Path, тип `.exe/.com/.cmd/.bat`, `null → ENOENT` |
| `src/platform/env.ts` (новый) | `getEnvCI`/`setEnvCI` |
| `src/platform/kill-tree.ts` (новый) | `taskkill /T /F`, POSIX `child.kill` |
| `src/platform/paths.ts` (новый, опц.) | `homeDir()` — единая точка |
| `bin/agento.ts` | `spawnCommand`, `cwd`, `isTTY`-guard, единый `runChildProcess` |
| `src/launcher/child.ts` | сигналы win32, `killTree`, `settle` ровно один раз |
| `src/launcher/transaction.ts` | `setEnvCI` для PATH/NO_PROXY, `pid` в манифесте |
| `src/launcher/shell-path-resolver.ts` | win32-фолбэки, `invalidate`, (опц.) reg refresh |
| `src/cli/commands/launch.ts` | код возврата, `error`, `cwd` |
| `src/installers/{npm,opencode,copilot,goose,kimi}.ts` | `spawnCommand`, winget/uv/pip, manual-ветки, `opencode-ai` |
| `src/installers/base.ts` | `manualInstructions` с windows-вариантом, `checkEnvironment(platform)` |
| `src/adapters/codex.ts` | `homedir()` + `CODEX_HOME` |
| остальные адаптеры | win32-ветки `configPaths` после проверки фактических путей |
| `src/config/atomic-write.ts` | `renameWithRetry`, ретраи `unlink` |
| `src/config/store.ts` | `encodeCwdForBackup` win32 |
| `src/config/git-exclude.ts` | без правок; добавить тесты `path.win32`, разные диски |
| `src/proxy/*.ts` | `closeAllConnections` + таймаут в `stop()` |
| `src/tui/use-key-input.ts` | заглавный ЙЦУКЕН |
| `src/tui/components/TextField.tsx` | отбрасывать `\r`/`\n` из вставки |
| `.github/workflows/ci.yml` | windows blocking, матрица 20/22, pwsh/cmd smoke, junit |
| `.gitattributes` (новый) | `* text=auto eol=lf`, `*.cmd text eol=crlf` |
| `.gitignore` | `!docs/windows-support/`, `!docs/windows-support/**`, `docs/windows-support/runs/` |
| `README.md`, `README.ru.md`, `AGENTS.md`, `CHANGELOG.md` | Windows-раздел, ограничения, правила слоя |

## 6. Тесты

- **Принципы:** платформа — параметр, не глобал; пути — через `path.join`; home — мок `node:os.homedir`; `skipIf` для реальных `.cmd`/`/bin/sh`; POSIX golden-тесты на неизменность.
- **Новые:** `resolve-executable` (чистая генерация кандидатов + ФС-поиск раздельно), `spawn` (аргументы с `&`, кавычками, пробелами; регрессия BatBadBut), `env` (нет дублей `Path`/`PATH`), `kill-tree`, `child` (матрица сигналов), `transaction` (env), `shell-path-resolver` (win32 + POSIX через инъекцию), installers (platform × ENOENT/ok/bad exit/timeout), `atomic-write` (ретраи), `store` (`C:\Proj` vs `c:\proj`, UNC, `CON`, длинный путь), `git-exclude` (win32), backup-recovery (stale pid).
- **Анти-флейк:** таймауты 20 с точечно для `cmd.exe`/`taskkill`; `rm` с `maxRetries:5`; junit-артефакт.

## 7. Расхождения двух планов и решения

| Вопрос | Claude | Antigravity | Решение |
|---|---|---|---|
| Запуск `.cmd` | cross-spawn в обёртке | собственный резолвер + своё экранирование | **Гибрид:** резолвер свой (диагностика/ENOENT), исполнение — cross-spawn 7.0.6. Своё экранирование не пишем |
| Оценка | ≈15.5 ч-д | ≈4.5 ч-д | **≈15.5.** Второй план не учитывает проверку путей конфигов 9 агентов, ручную приёмку TUI и циклы Windows-CI |
| `cross-spawn` CVE | требует ≥7.0.5 | «история уязвимостей» | **7.0.6** — актуальная, CVE-2024-21538/48910 закрыты (проверено `npm view`) |
| Installers | матрица с проверкой имён | `goose → winget Block.Goose`, `copilot.exe`, `opencode` | **Проверить перед реализацией.** `opencode` не существует (404); goose/copilot winget-id не подтверждены; copilot ставится npm-пакетом |
| Process tree | `taskkill /T /F` | `taskkill` + `process.kill(-pid)` | **`taskkill /T /F`.** `-pid` без `detached` убил бы сам agento |
| ЙЦУКЕН | не заметил | заглавные буквы не маппятся | **Принято** (проверено в коде) |
| `docs/` | новый `docs/windows-support/report.md` | «восстановить» старый отчёт | **Новый report.md**, ссылки перенаправить; старый файл не восстанавливаем |

## 8. Ручной чек-лист приёмки

Окружения: W11 + Windows Terminal (PowerShell 7), W10 + conhost (cmd), профиль с пробелом и кириллицей.

- [ ] `npm i -g @emaxe/agento` → `agento --version` в pwsh и cmd.
- [ ] TUI: стрелки/Enter/Esc/`q`, ЙЦУКЕН (`й`=q, `Н`=y, `Т`=n), resize, рамки, вставка ключа с `\r\n`.
- [ ] Провайдер/профиль: добавить, `agento provider list`.
- [ ] `agento launch -p P -a claude-code` (child): старт, Ctrl+C внутри агента, выход → конфиг восстановлен, бэкап удалён.
- [ ] Закрыть окно консоли во время агента → следующий запуск восстановил конфиг.
- [ ] Task Manager → End task → следующий запуск восстановил (Ф4).
- [ ] Independent: код возврата пробрасывается; `agento restore -a claude-code -s global`.
- [ ] Project-scope на `D:\` с пробелом: конфиг записан, `.git/info/exclude` обновлён, `git status` чист.
- [ ] Каждый из 9 агентов: статус/версия; автоустановка где заявлена; manual для goose.
- [ ] Прокси: claude с openai-compatible провайдером; брандмауэр молчит; порт освобождён.
- [ ] Путь >260: понятная ошибка или работа при `LongPathsEnabled`.

## 9. Реестр «ПРОВЕРИТЬ на windows-latest»

| # | Утверждение | Проверка |
|---|---|---|
| V1 | `spawn('x.cmd')` без shell → `EINVAL` на Node 20/22 | CI-шаг с `error.code` |
| V2 | Два ключа `Path`/`PATH` — какой победит | юнит: `echo %PATH%` с обоими |
| V3 | Точный список 10 падений | junit-артефакт |
| V4 | `cmd /c x.cmd` + Ctrl+C → «Terminate batch job (Y/N)?» | ручной тест с claude |
| V5 | `taskkill /T /F` убивает дерево `cmd → node` < 1 с | тест kill-tree |
| V6 | `process.kill(pid,0)` различает живой/мёртвый pid | юнит на win32 |
| V7 | `stdin.pause()` + `stdio:'inherit'` теряет первый символ | ручной чек-лист |
| V8 | Вставка `\r\n` в Ink 4 submit'ит форму | ручной чек-лист |
| V9 | Firewall молчит для loopback | ручной тест |
| V10 | `icacls` на кириллице/сетевых дисках | ручной тест (если делаем ACL) |
| V11 | `TextDecoder('ibm866')` доступен | `node -p` в CI |
| V12 | Имена пакетов/winget-id (claude, copilot, goose, opencode, uv) | `npm view`, `winget search` |
| V13 | `os.homedir()` в Git Bash; `HOME` POSIX-стиля | ручной тест |
| V14 | Фактические пути конфигов 9 агентов на Windows | установка каждого |
| V15 | `checkInstalled` ×9 параллельно ≤ 3 с | замер |

## 10. Риски и неустранимые ограничения

**Нельзя:**
1. `.ps1`-only при `Restricted/AllSigned` — политику не обходим, даём инструкцию.
2. Graceful-остановка консольного агента: у Windows нет SIGTERM; только принудительный tree kill.
3. Мгновенное восстановление после hard-kill — только отложенное, при следующем запуске.
4. Шифрование ключей в конфигах агентов.
5. Автоустановка goose (нет верифицированного канала) — manual.
6. Windows < 10 1809 / conhost с растровым шрифтом — деградация рамок, не блокер.

**Риски:**

| Риск | Влияние | Митигация |
|---|---|---|
| Неверные пути конфигов на Windows | агент не видит конфиг | Ф3, проверка каждого агента, win32-тесты `configPaths` |
| Экранирование `cmd.exe` | инъекция | cross-spawn 7.0.6, аргументы без пользовательского ввода, регрессия `&calc` |
| «Terminate batch job» | UX | прямой запуск `node cli.js` из разобранного `.cmd`, иначе документировать |
| Антивирус держит файл при `rename` | restore падает | ретраи, понятная ошибка |
| Правки `encodeCwdForBackup` ломают POSIX-бэкапы | осиротевшие бэкапы | ветвление строго по `platform`, golden-тест |
| Новая зависимость | аудит | `npm audit` уже в CI, обёртка позволяет заменить |
| Неверные имена пакетов | установка не работает | `npm view`/`winget search` в Ф3 до кодирования |

## 11. Итоговый чек-лист

- [ ] CI: windows Node 20/22 блокирующие, зелёные; pwsh/cmd smoke.
- [ ] 9 агентов: корректный статус/версия; автоустановка где заявлена, manual иначе.
- [ ] `launch` (child/independent) и TUI запускают `.cmd`/`.exe`; коды возврата и ENOENT корректны.
- [ ] Конфиг восстановлен при: выходе, ошибке запуска, Ctrl+C, Ctrl+Break, закрытии окна; после hard-kill — при следующем запуске.
- [ ] `PATH`/`Path` без дублей; `homedir()`; PATH обновляется после установки.
- [ ] `atomic-write` с ретраями; backup-ключ регистронезависим, безопасен по длине/именам.
- [ ] Прокси: loopback only, `stop()` не блокирует cleanup.
- [ ] Прямых `child_process` вне `src/platform` нет (ESLint).
- [ ] Тесты без POSIX-литералов; POSIX-поведение подтверждено golden-тестами.
- [ ] README EN/RU, AGENTS.md, CHANGELOG, report.md; битая ссылка устранена; `.gitignore` пропускает `docs/windows-support/**`, кроме `runs/`.
- [ ] Ручной чек-лист §8 пройден.

---

**Приложения:** `claude-plan.md` (детальные эскизы кода и таблицы), `agy-plan.md` (альтернативные
варианты и матрица инсталлеров), `BRIEF.md`, `runs/` (JSON-логи прогонов).
