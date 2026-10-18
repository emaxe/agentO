# План: полная поддержка Windows для AgentO

> Статус: план (код не менялся). База: `main` @ `423b00f`, v0.9.0.
> Метод: только статический анализ на Linux. Всё, что зависит от поведения Windows, помечено
> **«ПРОВЕРИТЬ на windows-latest»** с указанием, как проверить (см. §11 «Реестр непроверенных фактов»).
> Логи упавших windows-тестов получены через GitHub API после прогона планировщика; точный список
> 10 падений подтверждён (см. сводный `plan.md` §2). Фраза в предыдущей редакции этой шапки
> («логи получить не удалось») ошибочна.

---

## 1. Цель и границы

**Цель.** `npm i -g @emaxe/agento` на Windows 10 1809+/11 (Windows Terminal и conhost, PowerShell и cmd) даёт
то же, что на macOS/Linux: TUI, `agento launch`, `restore`, детект установленности, установка/обновление
агентов (где это технически возможно), child-режим с гарантированным восстановлением конфига.

**Входит:** 9 агентов (claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi), proxy-слой, store/backup,
CI, документация.

**Не входит (явно):**
- WSL — это Linux-путь, уже работает; в доках только упомянуть как рабочую альтернативу.
- Windows 7/8, Node < 18.20.2 (см. BatBadBut §3.1).
- Шифрование API-ключей (DPAPI/Credential Manager): агенты читают plaintext-конфиги сами, шифровать нечем (§7.3).
- Запуск `.ps1`-only шимов при `Restricted`/`AllSigned` ExecutionPolicy (§3.5).
- Нативный GUI-инсталлятор/MSI.

**Принцип:** POSIX-поведение не меняется ни на байт. Все платформенные развилки идут через один тонкий
слой `src/platform/*` с **инъекцией `platform`** (по образцу уже существующего `ShellPathResolverOptions.platform`,
`shell-path-resolver.ts:44`).

---

## 2. Карта проблем (файл:строка)

| # | Место | Проблема на Windows | Тяжесть |
|---|---|---|---|
| P1 | `src/launcher/child.ts:52-57` | `spawn('claude', …, {shell:false})` → ENOENT для `.cmd`-шимов; на пропатченном Node (CVE-2024-27980) даже полный путь к `.cmd` → `EINVAL` | блокер |
| P2 | `bin/agento.ts:41-44` (`spawnAsync`, путь TUI) | то же; ещё нет `cwd` | блокер |
| P3 | `src/cli/commands/launch.ts:125` (`spawnSync`, independent) | то же; код возврата игнорируется (`process.exit(0)`), `error` не проверяется | блокер |
| P4 | `src/installers/npm.ts:31,42,53,81,109` | `spawnSync/spawn('npm'|command)` → ENOENT → всегда «not installed», `checkEnvironment` → «npm missing» | блокер |
| P5 | `copilot.ts:12-56`, `goose.ts:12-56` | только `brew`; `kimi.ts:50,62,90` — `curl\|bash`, `bash`, `uv` | блокер (для этих 3 агентов) |
| P6 | `src/launcher/transaction.ts:73` (`{...cleanProcessEnv(), PATH: …}`) | `Object.entries(process.env)` даёт обычный объект с ключом `Path`; затем добавляется `PATH` → два ключа в разном регистре. Node на win32 дедуплицирует по uppercase и берёт один из них — какой именно, не гарантировано → резолвнутый PATH может быть проигнорирован. ПРОВЕРИТЬ | высокая |
| P7 | `src/launcher/shell-path-resolver.ts:8-17,156-160` | win32-ветка возвращает только системный PATH; нет типичных Windows-каталогов (`%APPDATA%\npm`, `~\.local\bin` для uv, WinGet Links, scoop shims). PATH снимается один раз на процесс — после установки агента в этой же сессии он не виден | средняя |
| P8 | `src/launcher/child.ts:87-100` | `child.kill('SIGINT'/'SIGTERM')` на Windows = безусловный `TerminateProcess`. Ctrl+C уже доставлен ребёнку тем же консольным событием → agento его добивает, хотя агент (напр. claude: «press Ctrl+C again to exit») обрабатывал сам. `SIGTERM` нет вообще; закрытие окна → `SIGHUP`; Ctrl+Break → `SIGBREAK` — не обрабатываются. Внуки (через `cmd.exe /c`) не убиваются | высокая |
| P9 | `src/adapters/codex.ts:59,86` | `process.env.HOME ?? homedir()`: на Windows `HOME` обычно не задан (ок), но в Git Bash/MSYS может быть POSIX-стиля (`/c/Users/x`) → мусорный путь. ПРОВЕРИТЬ | средняя |
| P10 | `src/config/atomic-write.ts:15-16` | `rename` поверх существующего файла: на Windows `EPERM/EACCES/EBUSY`, если целевой файл открыт другим процессом (агент, антивирус, индексатор) — нет ретраев | высокая (для restore!) |
| P11 | `atomic-write.ts:11` / везде `mode 0o600` | no-op на Windows; для файлов вне профиля пользователя (project-scope на `D:\work`) ACL наследуется от родителя, возможно «Users: read» | средняя |
| P12 | `src/config/store.ts:18-22` (`encodeCwdForBackup`) | (а) `C:\Proj` и `c:\proj` дают разные каталоги бэкапа → обход защиты «active backup already exists» и промах restore; (б) вложение полного cwd в путь `~/.agento/backups/<agent>/project/…` легко превышает MAX_PATH 260; (в) нет защиты от зарезервированных имён (`CON`, `NUL`, `AUX`, `COM1`…) и хвостовых точек/пробелов в сегментах | высокая |
| P13 | `src/config/git-exclude.ts:63-71` | Нормализация `\`→`/` уже есть (хорошо). Нужно проверить: регистронезависимость (`path.win32.relative` делает её сам), UNC, разные диски (`relative` вернёт абсолютный путь → отсекается `isAbsolute`, ок), CRLF в существующем `exclude` (`split('\n')`+`trim()` — ок), 8.3-имена (`RUNNER~1`) в тестах | низкая |
| P14 | `src/tui/run-loop.ts:19-21` | `isEnoent` — единственный признак «команда не найдена»; при `cmd.exe /c claude` отсутствие команды даёт **exit code 1** и текст в stderr, а не ENOENT → TUI покажет «успешный» запуск. Резолвер должен находить бинарь **до** spawn и сам бросать ENOENT | высокая |
| P15 | `src/proxy/*.ts` `stop()` (`anthropic-scrubber.ts:141-143` и аналоги) | `server.close()` ждёт keep-alive соединения; агент уже мёртв, но сокеты могут висеть → cleanup (а значит и restore конфига!) может зависнуть (на POSIX тот же риск, на Windows чаще из-за задержек закрытия сокетов). Нужен `closeAllConnections()` + таймаут | средняя |
| P16 | `.github/workflows/ci.yml:23-31` | windows-job non-blocking, Node только 20; нет `.gitattributes` → `actions/checkout` на Windows делает CRLF, Prettier/ESLint/снапшоты могут вести себя иначе | средняя |
| P17 | README:45-49, `ci.yml:25-26` | ссылки на несуществующий `docs/windows-cross-platform-report.md` (`.gitignore:8` игнорирует `docs/*`) | низкая |
| P18 | Тесты (список из брифа, ПРОВЕРИТЬ логами) | хардкод POSIX-путей; сценарии `shell-path-resolver.test.ts`, рассчитанные на POSIX-хост; тесты, подменяющие `process.env.HOME` (на Windows `os.homedir()` читает `USERPROFILE`) | блокер CI |
| P19 | `src/tui/*` | Ink `render` без TTY бросает «Raw mode is not supported»; на CI/пайпе это даст стектрейс вместо понятной ошибки (общая проблема, на Windows чаще в IDE-терминалах) | низкая |

---

## 3. Запуск агентов: варианты и выбор

### 3.1 Исходные факты про Windows/Node

1. `CreateProcess` запускает только `.exe`/`.com`; libuv перебирает по `PATH` только эти два расширения. `.cmd`/`.bat` нужен `cmd.exe`.
2. **CVE-2024-27980 («BatBadBut»).** Node ≥ 18.20.2 / 20.12.2 / 21.7.3 при `spawn('x.cmd', …)` без `shell:true`
   бросает `EINVAL`. То есть «найти полный путь к `claude.cmd` и спавнить его напрямую» **не работает**.
   ПРОВЕРИТЬ на windows-latest: `node -e "require('child_process').spawnSync('C:\\path\\x.cmd')"` → `error.code === 'EINVAL'`.
3. Правильный вызов `.cmd`: `spawn(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c', '"<cmdline>"'], {windowsVerbatimArguments:true})`
   с корректным экранированием метасимволов `cmd` (`^`-эскейпинг `& | < > ^ % !`, двойное — для `.cmd`-шимов, т.к. они разбирают аргументы повторно).
   Именно здесь происходят все реальные ошибки (BatBadBut — уязвимость в экранировании).
4. npm создаёт для bin три файла: `x` (sh), `x.cmd`, `x.ps1`. PATHEXT по умолчанию: `.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC` (+иногда `.CPL`). `.ps1` в PATHEXT **нет** → `cmd` его не найдёт, `.cmd` найдётся.
5. Часть агентов ставится нативными `.exe` (winget, официальные установщики, `uv tool` → `%USERPROFILE%\.local\bin\kimi.exe`). Для них спец-обработка не нужна — только PATH.

### 3.2 Сравнение

| Вариант | + | − |
|---|---|---|
| A. `shell: true` только на win32 | 1 строка | Склеивает `command + args` в строку без экранирования → инъекции/поломка на пробелах; `shell:true` + args — deprecated-предупреждение (DEP0190, Node 24); ENOENT не возникает (ошибка уходит в exit code 1 — ломает P14); `cmd.exe` для всего, включая `.exe` |
| B. `cross-spawn` | Де-факто стандарт, PATHEXT, шебанги, экранирование `.cmd` с BatBadBut-фиксом (≥7.0.5), даёт настоящий ENOENT, `sync` вариант | +1 runtime-зависимость (+ транзитивные `which`, `path-key`, `shebang-command`); платформа не инъектируема (читает `process.platform`) → тестировать нужно через мок обёртки |
| C. Свой резолвер: PATHEXT + `cmd.exe /d /s /c` | Ноль зависимостей, полный контроль, инъекция платформы/fs для тестов | Нужно самим корректно экранировать (самая рискованная часть), ~150 строк + поддержка |

### 3.3 Выбор: **B (cross-spawn), в тонкой собственной обёртке**

Обоснование: экранирование для `cmd.exe` — security-чувствительная и тонкая область (см. BatBadBut); писать её заново
ради отказа от одной небольшой зависимости — плохая сделка. Аргументы наших spawn'ов сегодня статичны
(`--version`, `-p default`, `session`), но `command` = путь с пробелами (`C:\Program Files\nodejs\`), `cwd` с кириллицей/пробелами, и в будущем
аргументы могут стать пользовательскими. Обёртка изолирует выбор: при необходимости cross-spawn заменяется на C без правки вызывающих.

Обёртка — новый модуль `src/platform/spawn.ts` (единственная точка спавна во всём проекте):

```ts
import crossSpawn from 'cross-spawn';
import type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';

export interface PlatformDeps { platform?: NodeJS.Platform }

/** Единая точка запуска: на win32 резолвит .cmd/.bat-шимы, на POSIX — прозрачный node:child_process. */
export function spawnCommand(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return crossSpawn(cmd, args, { shell: false, ...opts });   // POSIX: идентично текущему поведению
}
export function spawnCommandSync(cmd: string, args: string[], opts: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  return crossSpawn.sync(cmd, args, { shell: false, ...opts });
}
```

Замечания по реализации:
- `cross-spawn` — CJS; в ESM-проекте `import crossSpawn from 'cross-spawn'` работает (default = module.exports). Типы: `@types/cross-spawn` в devDependencies.
- На POSIX `cross-spawn` делегирует `child_process.spawn` без изменений → регрессии POSIX исключены (покрыть тестом §8).
- **Предрезолвинг (для P14).** Перед `spawn` вызывать `which`-подобный `resolveExecutable(cmd, env)` (`cross-spawn` его не экспортирует → использовать зависимость `which` напрямую, она и так транзитивная; либо 25 строк своей реализации с PATHEXT, см. эскиз ниже) и при `null` самим эмитить ENOENT (`Object.assign(new Error(`spawn ${cmd} ENOENT`), {code:'ENOENT'})`). Это сохраняет контракт `isEnoent()` из `run-loop.ts:19`.
- Резолв делать по **тому env, с которым будет запуск** (`execReq.env`, а не `process.env`), иначе найденный бинарь и запускаемый разойдутся.

```ts
// src/platform/resolve-executable.ts — эскиз (win32-ветка; POSIX = проверка +x по PATH)
export function resolveExecutable(cmd: string, env: NodeJS.ProcessEnv, platform = process.platform): string | null {
  const isWin = platform === 'win32';
  const P = isWin ? path.win32 : path.posix;
  const pathVar = getEnvCI(env, 'PATH') ?? '';
  const exts = isWin ? (getEnvCI(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const hasExt = isWin && P.extname(cmd) !== '';
  const dirs = P.isAbsolute(cmd) || cmd.includes(P.sep) ? [''] : pathVar.split(isWin ? ';' : ':').map(unquote);
  for (const dir of dirs) for (const ext of hasExt ? [''] : exts) {
    const candidate = dir ? P.join(dir, cmd + ext) : cmd + ext;
    if (isFile(candidate)) return candidate;        // fs.statSync().isFile(); на POSIX + X_OK
  }
  return null;
}
```
(`.ps1` намеренно в список не входит — §3.5.)

### 3.4 Что сделать со вторым слоем: kill-дерева и Ctrl+C

Обёртка `cmd.exe /c x.cmd` создаёт цепочку `agento → cmd.exe → node.exe (агент)`. Следствия (разобраны в §6):
`child.pid` — это `cmd.exe`; `child.kill()` убьёт только `cmd.exe`, агент осиротеет. Поэтому для win32 нужна `killTree(pid)` через `taskkill /pid N /T /F`.

Опциональная оптимизация (Фаза 5, не обязательная): для стандартных npm-шимов разбирать `x.cmd` и запускать напрямую
`node.exe <pkg>/cli.js` — убирает `cmd.exe`-посредника, проблему «Terminate batch job (Y/N)?» на Ctrl+C и двойное
экранирование. Формат шима (`cmd-shim`) стабилен, но парсинг хрупок → делать только с фолбэком на cross-spawn.
**Проблема «Terminate batch job (Y/N)?» реальна** (`cmd /c file.cmd` + Ctrl+C) — ПРОВЕРИТЬ на claude из npm; если воспроизводится, оптимизация переходит из «опциональной» в обязательную.

### 3.5 `.ps1`, ExecutionPolicy, pnpm/yarn

- Не резолвим `.ps1` и не запускаем через `powershell -File`: при `Restricted` (дефолт клиентской Windows) это падает, а
  `-ExecutionPolicy Bypass` — осознанный обход политики безопасности, которого агент без согласия пользователя делать не должен.
  Достаточно: npm/pnpm/yarn **всегда** создают и `.cmd`. Если найден только `.ps1` — понятная ошибка:
  `"<cmd>" is only available as a PowerShell script; install it so a .cmd/.exe shim exists, or run agento from PowerShell with ExecutionPolicy allowing scripts`.
  Это единственное, что **принципиально не поддерживаем** (§10).
- pnpm: шимы в `%LOCALAPPDATA%\pnpm` (`.cmd` + `.ps1` + sh) — работают через общий путь. Yarn classic: `%LOCALAPPDATA%\Yarn\bin`. Bun: `~\.bun\bin\*.exe`. Всё через PATH — добавить эти каталоги в win32-фолбэк PATH (§5).
- `COMSPEC`: cross-spawn использует `process.env.comspec || 'cmd.exe'`. Резолвер берёт `ComSpec` из **env запуска** (регистронезависимо). Если не задан — `cmd.exe` по PATH (`System32`).
- Пробелы в путях: `C:\Program Files\nodejs\npm.cmd` — cross-spawn оборачивает в кавычки; `/s` + внешние кавычки обязательны. Покрыть юнит-тестом на уровне нашей обёртки интеграционным тестом на Windows (§8.4).
- `windowsHide: true`: для **фоновых** вспомогательных процессов (`taskkill`, `where`, `icacls`, `winget --version`, `npm --version`) — чтобы не мигали консольные окна, если agento запущен без своей консоли (Task Scheduler, IDE). Для самого агента **не** ставить: он наследует консоль (`stdio:'inherit'`).

---

## 4. Определение установленности и установка

### 4.1 `checkInstalled`

Сейчас: `spawnSync(cmd, ['--version'])` (`npm.ts:31`, `copilot.ts:15`, `goose.ts:15`, `kimi.ts:23`).
Изменения:
1. Заменить на `spawnCommandSync` (`src/platform/spawn.ts`) + `windowsHide:true`, `timeout: 10_000`, `env: <PATH из shellPathResolver>` — **без** этого после `npm i -g` в той же сессии бинарь не виден (P7).
2. Различать «не найден» (`result.error?.code === 'ENOENT'`) и «найден, но `--version` вернул ≠ 0». Сейчас оба = «not installed»; на Windows при проблемах с шимом это путает. Добавить в `InstallCheckResult` необязательное `reason?: 'not-found' | 'failed' | 'timeout'` (обратная совместимость: потребители читают только `installed`/`version`). Кэш `agent-status.json` (`{installed, version?}`) не меняется.
3. Время: `cmd.exe`→`node` старт ~150–400 мс на агента; 9 агентов последовательно в TUI = заметная пауза. Запускать `Promise.all` + асинхронный `spawn` вместо `spawnSync` (иначе блокируется event loop Ink). ПРОВЕРИТЬ замером на windows-latest.
4. Кодировка вывода: версии — ASCII, `/(\d+\.\d+\.\d+[^\s]*)/` безопасен при любой кодовой странице. Сообщения об ошибках (stderr winget/npm) могут быть в OEM-866/1251 → при показе пользователю декодировать `new TextDecoder('ibm866')` для `winget`/`cmd` (если `TextDecoder` с этим label доступен в сборке Node — ПРОВЕРИТЬ), иначе показывать как есть.

### 4.2 Матрица установки (Windows)

Принцип: **автоустановка только там, где есть надёжный неинтерактивный канал; иначе — честный «manual only»** с точной командой и ссылкой. Интерфейс `AgentInstaller` расширяем: `manualInstructions` → `manualInstructions: { commands: string[]; docsUrl: string; windows?: { commands: string[] } }` и `checkEnvironment()` учитывает платформу.

| Агент | Канал на Windows | Автоустановка из agento | Примечание / что проверить |
|---|---|---|---|
| claude-code | `npm i -g @anthropic-ai/claude-code`; нативный: `irm https://claude.ai/install.ps1 \| iex` | да, через npm (если есть Node/npm); иначе manual | пакет ставит нативный бинарь через postinstall; шим всё равно `.cmd`. ПРОВЕРИТЬ актуальную рекомендацию Anthropic и наличие winget-id |
| opencode | `npm i -g opencode-ai` (реальное имя пакета; в репо `opencode.ts` указано `opencode` — **вероятно, не тот пакет, сверить с npm registry и на macOS/Linux тоже**); scoop `opencode`; choco | да, через npm | отдельная находка, не Windows-специфика |
| qwen | `npm i -g @qwen-code/qwen-code@latest` | да | — |
| codex | `npm i -g @openai/codex` | да | agent `dev:true`; на Windows OpenAI рекомендует WSL — отразить в доке, не блокировать |
| pi | `npm i -g @earendil-works/pi-coding-agent` | да | — |
| kilo | `npm i -g @kilocode/cli` | да | — |
| copilot | `npm i -g @github/copilot`; `winget install GitHub.Copilot` | да, цепочка: winget → npm → manual | заменить `brew`-логику. ПРОВЕРИТЬ точные id/имена пакетов (`winget search copilot`) |
| goose | нет npm/winget-пакета с гарантией; официальный `download_cli.ps1` / zip с релизов GitHub (block/goose) | **нет — только manual** (команда + ссылка) | честно: auto-install не делаем; `checkInstalled` работает, `checkEnvironment` возвращает `{ok:false, missing:['manual install']}` в TUI-визарде показывает manual-экран |
| kimi | `uv tool install --python 3.13 kimi-cli`; uv: `winget install astral-sh.uv` или `irm https://astral.sh/uv/install.ps1 \| iex` | да, **если `uv` уже есть** (`uv tool install …`); иначе manual с двумя командами | нельзя `curl\|bash`. После установки `uv` кладёт `kimi.exe` в `%USERPROFILE%\.local\bin`, который может не быть в PATH → §5 |

Реализация по файлам:
- `src/installers/npm.ts`: все `spawn('npm', …)`/`spawnSync('npm', …)` → `spawnCommand`/`spawnCommandSync`. Дедуплицировать три почти одинаковых `Promise`-блока (`install/update/uninstall`, `npm.ts:49-131`) в `runNpm(args)`; это упростит замену спавна и тесты.
- `src/installers/copilot.ts`, `goose.ts`: ветка `process.platform === 'win32'` в `checkEnvironment/install/update/uninstall` (через инъекцию платформы в конструктор: `new CopilotInstaller({platform})`; сингл-тон экспортируется с дефолтом).
- `src/installers/kimi.ts`: win32: `checkEnvironment` проверяет `uv`; `install/update` → `uv tool install --python 3.13 kimi-cli` / `uv tool upgrade kimi-cli`; `_runScript` с `bash` на win32 не вызывать никогда.
- Эскиз общей части:

```ts
// src/installers/run.ts
export function runTool(cmd: string, args: string[]): Promise<InstallResult> {
  return new Promise((resolve) => {
    const err: Buffer[] = [];
    const child = spawnCommand(cmd, args, { stdio: ['ignore', 'inherit', 'pipe'], windowsHide: false });
    child.stderr?.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e) => resolve({ success: false, error: e.message }));
    child.on('exit', (code) => resolve(code === 0 ? { success: true }
      : { success: false, error: Buffer.concat(err).toString('utf8').trim() || `${cmd} exited with code ${code}` }));
  });
}
```
- После успешной установки/обновления вызывать `shellPathResolver.invalidate()` (метод уже есть, `shell-path-resolver.ts:81`) и перечитать PATH (§5).
- `npm i -g` на Windows может требовать прав, если prefix в `C:\Program Files\nodejs` → ошибка `EPERM`/`EACCES`: распознавать и подсказывать «run terminal as Administrator or set `npm config set prefix %APPDATA%\npm`».

---

## 5. PATH и окружение

1. **Регистр ключей env (P6).** Новый хелпер `src/platform/env.ts`:

```ts
export function getEnvCI(env: Record<string, string | undefined>, name: string, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}
/** Устанавливает значение, сохраняя существующее написание ключа (Path), и удаляет дубли других регистров. */
export function setEnvCI(env: Record<string, string>, name: string, value: string, platform = process.platform): void {
  if (platform !== 'win32') { env[name] = value; return; }
  let target = name;
  for (const k of Object.keys(env)) if (k.toUpperCase() === name.toUpperCase()) { target = k; if (k !== name) delete env[k]; }
  env[target] = value;
}
```
   Применить в `transaction.ts:67-76` (`PATH`), в `withNoProxyLoopback` (чтение/запись `NO_PROXY`/`HTTP_PROXY`…; на Windows переменные часто в верхнем регистре, но не гарантировано), и в адаптерном `buildEnv` при слиянии (`{...cleanProcessEnv(), PATH, ...adapterEnv}` — adapterEnv тоже может задавать `Path`-подобные ключи; сливать через `setEnvCI`).
2. **PATHEXT.** Не копируем в `buildExecRequest` явно (он уже в `process.env`), но резолвер читает его из `execReq.env`; если пуст — дефолт `.COM;.EXE;.BAT;.CMD`.
3. **Win32-фолбэк PATH.** В `shell-path-resolver.ts` рядом с `FALLBACK_PATHS` (POSIX-only, строки 8-17) добавить `WIN32_FALLBACK_PATHS`, применяемый **только если** каталога нет в PATH и он существует (`existsSync`):
   `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`, `%USERPROFILE%\.local\bin` (uv tool / kimi), `%USERPROFILE%\.cargo\bin`, `%USERPROFILE%\.bun\bin`, `%USERPROFILE%\scoop\shims`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%ProgramFiles%\nodejs`. Сейчас win32-ветка (`:110-112`) возвращает только `Path` — **её сохранить**, дополнить.
4. **Обновление PATH без перезапуска терминала.** После `winget/npm/uv install` реестровый PATH меняется, а процесс agento несёт старую копию. Добавить на win32 в `_doResolve` опцию `refreshFromRegistry`: прочитать `HKCU\Environment\Path` и `HKLM\...\Session Manager\Environment\Path` через `reg query … /v Path` (`execFile('reg', …, {windowsHide:true})`), развернуть `%VAR%` (REG_EXPAND_SZ), слить (user перед system, как делает Windows), объединить с текущим. Вызывать при `invalidate()` после установок и (лениво) при ENOENT в `launch`. ПРОВЕРИТЬ парсинг вывода `reg query` на нелатинской локали (ключевые слова `REG_SZ`/`REG_EXPAND_SZ` не локализуются, названия значений — нет).
5. **HOME vs USERPROFILE (P9).** Заменить `process.env.HOME ?? homedir()` на `homedir()` в `codex.ts:59,86` — `os.homedir()` на POSIX читает `$HOME`, на Windows `USERPROFILE`, т.е. поведение на POSIX сохраняется, а в Git Bash не получаем `/c/Users/x`. Дополнительно учесть `CODEX_HOME` (если задан — приоритет; это штатная переменная Codex). Остальные адаптеры уже используют `homedir()`. Зафиксировать единый хелпер `src/platform/paths.ts: homeDir()`; в тестах мокать `node:os.homedir` (`vi.mock`), а не `process.env.HOME`.
6. **XDG-подобные пути на Windows.** `opencode.ts:53`, `goose.ts:51`, `kilo.ts:54` используют `~/.config/...`. Реальные агенты на Windows могут читать другие места (goose: `%APPDATA%\Block\goose\config\config.yaml`; opencode — `~/.config/opencode` через `xdg-basedir`, на Windows это `%USERPROFILE%\.config`, ок; kilo — унаследован от opencode). **Критично**: если адаптер пишет конфиг не туда, где его читает агент, всё «запустилось, но не работает». Для каждого из 9 агентов проверить фактическое расположение конфига на Windows по документации/установке и завести `configPaths` с win32-веткой. Это отдельная подзадача Фазы 3, результат — таблица в `docs/windows-support/report.md`. Без проверки на реальной машине помечать как «ПРОВЕРИТЬ».
7. **Слияние env при запуске.** Порядок сохраняем: `process.env` → PATH (resolved) → `adapterEnv`. Значения env на Windows ограничены 32 767 символами на переменную — PATH на dev-машинах бывает длинным; дедупликация (`_dedupe`) уже есть. Не логировать env.

---

## 6. Сигналы и cleanup

### 6.1 Поведение платформы (ПРОВЕРИТЬ всё в Фазе 2 интеграционным тестом на windows-latest)

- Нет `SIGTERM`/`SIGKILL` как сигналов. `child.kill(any)` = `TerminateProcess` (немедленно, без обработчиков, без каскада на потомков).
- `process.on('SIGINT')` срабатывает на Ctrl+C **в консоли**; то же `CTRL_C_EVENT` получает **каждый процесс, подключённый к этой консоли**, включая ребёнка со `stdio:'inherit'`. Т.е. агент уже обработал Ctrl+C сам.
- `SIGBREAK` — Ctrl+Break. `SIGHUP` — закрытие окна консоли (Node успевает ~несколько секунд до принудительного завершения процессов Windows).
- Диспетчер Задач «End task» / `taskkill /F` на agento — необработываемый kill → cleanup не выполняется (как `kill -9` на POSIX).

### 6.2 Изменения в `src/launcher/child.ts`

```ts
const isWin = process.platform === 'win32';            // инъектируемо: options.platform

function handleSignal(signal: NodeJS.Signals): void {
  if (isWin && signal === 'SIGINT') return;             // ребёнок получил тот же CTRL_C_EVENT; не добивать
  if (signalled) { void killTree(child, 'force'); return; }
  signalled = true;
  void killTree(child, signal);                         // POSIX: child.kill(signal); win32: taskkill /T /F
  if (!isWin) { killTimer = setTimeout(() => void killTree(child, 'force'), SIGNAL_EXIT_GRACE_MS); killTimer.unref(); }
}
for (const s of isWin ? ['SIGINT','SIGBREAK','SIGHUP'] as const : ['SIGINT','SIGTERM'] as const) process.on(s, handleSignal);
```
(`settle` аналогично снимает все подписанные сигналы.) `killTree` в `src/platform/kill-tree.ts`:

```ts
export async function killTree(child: ChildProcess, mode: NodeJS.Signals | 'force', platform = process.platform) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (platform !== 'win32') { child.kill(mode === 'force' ? 'SIGKILL' : mode); return; }   // POSIX как раньше
  await new Promise<void>((res) => {
    const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    k.on('error', () => { child.kill(); res(); });           // фолбэк: хотя бы родитель
    k.on('exit', () => res());
  });
}
```
- **SIGINT в child-режиме на Windows: игнорировать.** Если агент не завершается по Ctrl+C сам (завис) — пользователь использует закрытие окна/Ctrl+Break (→ tree kill) или Task Manager. Альтернатива «второй Ctrl+C за 3 с — kill» оставить как опцию: счётчик в `handleSignal` (первый — игнор, второй в течение окна 3 с — `killTree`). Принять второй вариант (UX сохраняет «второй Ctrl+C = выйти», как задумано в текущем комментарии `child.ts:80-86`).
- Ctrl+C в raw-режиме Ink (`exitOnCtrlC`) приходит символом `\x03`, а не сигналом: во время TUI (до запуска агента) всё как на POSIX.
- `exit` vs `close`: оставить `exit` для запуска cleanup; `stdio:'inherit'` потоков нет.
- На `SIGHUP/SIGBREAK` cleanup обязан уложиться в секунды: порядок — `killTree` → `settle()` (restore). `restoreBackupManifest` — несколько `readFile/writeFile`; с ретраями §7.1 худший случай ~1–2 с. Если за 3 с не успели — полагаемся на восстановление при следующем старте (§6.3).

### 6.3 Гарантия восстановления при необработываемом kill (новое, полезно для всех ОС)

Сейчас единственная защита — «Active backup already exists → выполните `agento restore`». На Windows hard-kill окна — частый сценарий.
- В манифест v2 (`store.ts`, `BackupManifest`) добавить **необязательные** поля `pid: number`, `pidStartedAt?: string` (обратно совместимо; `readBackup` их игнорирует у старых бэкапов).
- В `prepareLaunchTransaction` при обнаружении active backup: если `pid` записан и процесса с таким pid нет (`process.kill(pid, 0)` → `ESRCH`; на Windows `process.kill(pid,0)` работает как проверка существования — ПРОВЕРИТЬ) → автоматически вызвать restore и продолжить с предупреждением `Recovered config from a previous crashed session`. Если процесс жив — прежняя ошибка. Проверка владельца по pid ненадёжна из-за переиспользования pid → дополнительно сравнивать `createdAt` с временем старта процесса (`wmic`/`Get-Process` — слишком тяжело; принять риск, при живом pid остаёмся на безопасной ошибке).
- Эту логику вынести в отдельную Фазу 4, т.к. меняет и POSIX-поведение (в лучшую сторону) и требует тестов transaction.

### 6.4 Прочее
- Таймауты: `SIGNAL_EXIT_GRACE_MS` (5 с) на Windows не используется (нет graceful-канала для консольных программ, кроме Ctrl+Break, которое Node не умеет слать ребёнку без `GenerateConsoleCtrlEvent`).
- `bin/agento.ts:41` (`spawnAsync` в TUI): тоже `spawnCommand`, + передать `cwd: process.cwd()` явно; сигналы там не перехватываются, но Ink уже размонтирован → Ctrl+C уходит и в agento, и в ребёнка; **agento по умолчанию завершится по SIGINT** (дефолтный обработчик) раньше, чем отработает `cleanup()` в `run-loop.ts`. Проверить на POSIX тоже; для паритета с `launchChild` добавить в `runTuiLoop`/`spawnAsync` те же обработчики, либо (проще) унифицировать: TUI-путь должен вызывать тот же `runChild(execReq)` из `child.ts`. Рекомендуется вынести ядро (`spawn + signals + settle`) из `launchChild` в `runChildProcess(execReq, {cwd, platform})` и использовать в обоих местах.
- `src/cli/commands/launch.ts:125` (independent): вернуть реальный `status`, обработать `error` (ENOENT → «Command "x" not found» + `exit 127`/`1`), передать `cwd`.

---

## 7. Файловая система

### 7.1 Атомарная запись и rename (P10)

`fs.rename` на Windows заменяет существующий файл (ПРОВЕРИТЬ на нужной версии Node), но падает `EPERM/EACCES/EBUSY` при открытом целевом файле. Добавить ретраи только на win32:

```ts
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function renameWithRetry(from: string, to: string, platform = process.platform) {
  const max = platform === 'win32' ? 8 : 1;
  for (let i = 0; ; i++) {
    try { return await rename(from, to); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (i + 1 >= max || !RETRYABLE.has(code)) throw e;
      await new Promise((r) => setTimeout(r, Math.min(25 * 2 ** i, 400)));   // суммарно ≈ 1 с
    }
  }
}
```
Тот же ретрай — для `unlink` в restore-ветке «`hadFile=false` → удалить файл» (`restoreBackupManifest`, `deleteBackup`). Файл `atomic-write.ts` остаётся единственным местом записи.

### 7.2 Пути, регистр, длина, Unicode
- **Бэкап-ключ cwd (P12).** `encodeCwdForBackup` на win32: нормализовать `path.win32.normalize`, `toLowerCase()` (NTFS регистронезависим), заменить `:`; добавить защиту зарезервированных имён (`/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i` → префикс `_`) и обрезку хвостовых `.`/пробелов. Против MAX_PATH: если итоговая длина каталога бэкапа > ~200 символов — заменить хвост на `sha1(cwd).slice(0,16)`. **Раскладка на POSIX не меняется** (иначе осиротеют активные бэкапы пользователей). Чтение старых win32-бэкапов (если у кого-то были) — не актуально, т.к. Windows не поддерживался.
- **Длинные пути > 260.** Node на Windows 10 1607+ с включённым `LongPathsEnabled` (реестр/манифест) работает; без него — нет. Не добавлять префикс `\\?\` везде (ломает `relative`, `git`). Стратегия: избегать длинных путей самим (хеширование, выше), для остального — ловить `ENAMETOOLONG`/`ENOENT` на длинных путях и выдавать подсказку про `LongPathsEnabled`. ПРОВЕРИТЬ воспроизведением в тесте с каталогом >260 (на windows-latest long paths обычно выключены).
- **Кириллица/Unicode в путях.** Node использует UTF-16 API (`CreateFileW`) → пути с кириллицей работают независимо от кодовой страницы. Риски только в (а) JSON/TOML/YAML-конфигах агентов — писать всегда UTF-8 **без BOM** (проверить, что `writeFile(..., 'utf-8')` везде, а не `toString` PowerShell-стиля), (б) выводе внешних утилит в OEM (§4.1), (в) передаче путей в argv `cmd.exe` — cmd.exe читает argv в UTF-16, но `.cmd`-батники с символами вне текущей OEM-страницы могут искажаться (ПРОВЕРИТЬ тестом: `cwd = C:\Тест Проект`, запуск `.cmd`-шима).
- Окончания строк: все генерируемые конфиги — `\n`; не конвертировать. `.gitattributes`: `* text=auto eol=lf` (§9), чтобы Prettier/тест-фикстуры на Windows не получали CRLF.
- **Project-scope пути.** `configPaths(cwd)` во всех адаптерах строятся через `join` → на Windows дают обратные слэши — корректно. Ловушки в тестах (P18), не в коде.
- **`git-exclude.ts` (P13).** Кодовых правок не требуется; добавить тесты с `path.win32` (диск `C:`, `c:` в разном регистре, UNC, worktree с `gitdir: C:/…`, CRLF в exclude). Если тесты выявят расхождения регистра — сравнивать `toLowerCase()` на win32 в `findGitRoot`/`toExcludePattern`.

### 7.3 Защита API-ключей (ACL/DPAPI) — оценка
- **DPAPI/Credential Manager: не делаем.** Агенты читают ключ из своего plaintext-конфига/env; зашифровать значит сломать совместимость. Нативные зависимости (keytar) — тяжёлый груз для CLI.
- **ACL: делаем best-effort, P2.** Дефолтные ACL внутри `%USERPROFILE%` уже ограничивают доступ владельцу, SYSTEM и Administrators → для `~/.agento/*` и `~/.claude/…` риск низкий. Хуже `project`-scope вне профиля (`D:\work\…`; на не-системных дисках наследуется `Users:(RX)`/`Authenticated Users`). Решение: после записи в `writeFileAtomic` на win32 вызывать (по флагу, по умолчанию on только для файлов `~/.agento/**`):
  `icacls "<file>" /inheritance:r /grant:r "<USERDOMAIN>\<USERNAME>:F"` (`execFile`, `windowsHide`, ошибки глотать + одно предупреждение). Для файлов агентов в project-scope — выводить предупреждение, что ключ лежит в проекте (и так уже есть `.git/info/exclude`-предупреждение, `transaction.ts:131-150`). ПРОВЕРИТЬ: `icacls` на путях с кириллицей, на сетевых дисках (может вернуть ошибку — допустимо).
- Документировать: «на Windows mode 0o600 не применяется; защита обеспечивается ACL профиля пользователя».

---

## 8. TUI (Ink 4 / React)

Что известно по коду: `use-key-input.ts` — обёртка `useInput` с маппингом ЙЦУКЕН; `bin/agento.ts:70` — `process.stdin.pause()` перед спавном.

Риски и проверки (все «ПРОВЕРИТЬ вручную в Windows Terminal + conhost, PowerShell и cmd»; автотест на CI невозможен без ConPTY, см. ниже):
1. **Raw mode.** libuv реализует raw-режим для консоли сам (в т.ч. перевод клавиш в VT-последовательности); стрелки/Enter/Esc/Backspace/Ctrl+C приходят как в Unix. Проверить: стрелки, `Home/End/Del`, `Ctrl+←/→` (Ink 4 их не использует), `Alt+<key>` (префикс ESC).
2. **Кириллица ввод/вывод.** TTY-вывод Node идёт через `WriteConsoleW` (UTF-16) → кодовая страница на отрисовку не влияет; шрифт conhost по умолчанию (Raster/Consolas) может не иметь кириллицы/рамок → «квадраты» в старом conhost. Рамки Ink (`╭─╮`) есть в Consolas/Cascadia; **«ПРОВЕРИТЬ в conhost с Raster Fonts»**, фолбэк — ASCII-рамки при `process.platform==='win32' && !process.env.WT_SESSION && !process.env.TERM_PROGRAM` (borderStyle `'classic'`). ЙЦУКЕН-маппинг прозрачен: символы приходят Unicode.
3. **Guard-тест кириллицы** (`src/tui/english-ui.test.ts`): он уже правился под Windows-разделители (`10aa2fb`); ПРОВЕРИТЬ, что остаётся зелёным на CRLF-чекаут (`.gitattributes` решает).
4. **Вставка.** Ink 4 не поддерживает bracketed paste; вставка многострочного/длинного текста приходит чанком(ами). Windows Terminal при вставке `\r\n` может слать `\r` → Ink воспримет как Enter и отправит форму. Проверить поле API-ключа/URL: вставить значение с trailing newline. Если воспроизводится — в `TextField` отбрасывать `\r`/`\n` из пасты (изменение безопасно и для POSIX).
5. **Ресайз.** `process.stdout.on('resize')` на Windows работает (libuv опрашивает консоль). Ink перерисовывает; ПРОВЕРИТЬ мерцание/артефакты при уменьшении окна в conhost.
6. **Передача терминала агенту (`stdin.pause`).** На Windows чтение stdin идёт отдельным потоком libuv; после `pause()` и перед спавном первый символ может быть «съеден» (гонка). Проверить: после запуска claude из TUI сразу набрать символ. Если теряется — добавить `process.stdin.setRawMode?.(false)` и `process.stdin.unref()`/`destroy()` до спавна (только win32).
7. **Нет TTY (CI, pipe, IDE-вывод).** Ink бросает на `setRawMode`. Добавить в `bin/agento.ts` (default action): `if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('agento: the interactive TUI needs a terminal. Use `agento launch -p … -a …`.'); process.exit(2); }` — полезно и для POSIX. Тест: `spawnSync(node, [dist/bin/agento.js])` с pipe-stdio → код 2 + сообщение.
8. **E2E TUI на CI.** Опционально (Фаза 6): ConPTY через `@lydell/node-pty`/`node-pty` в devDependencies — запустить `agento`, послать `\x1b[B`, `\r`, `q`, проверить выход. Нативная сборка усложняет CI → только как non-blocking job `windows-tui-e2e` и после стабилизации основного набора.
9. `chalk`: на Windows определяет поддержку цвета по `WT_SESSION`/версии ОС; в старых conhost (< Win10 1511) цвета нет — игнорируем (вне поддержки).

---

## 9. Локальный proxy

Код: три сервера слушают `127.0.0.1` на порту `0` (`anthropic-scrubber.ts:132`, `openai-proxy.ts:280`, `responses-proxy.ts:271`), URL = `http://127.0.0.1:<port>`. Оценка:

| Риск | Оценка | Действие |
|---|---|---|
| Windows Firewall prompt | Для сокета, слушающего **только loopback**, диалог брандмауэра не показывается. Риск минимален, пока не появится `0.0.0.0`/`::` | Добавить регрессионный тест: `server.address().address === '127.0.0.1'`. ПРОВЕРИТЬ на реальной Windows (интерактивный профиль) — на CI не проверяется |
| `localhost` → `::1` | Используем литерал `127.0.0.1` — безопасно. `NO_PROXY` уже содержит `127.0.0.1,localhost,::1` (`transaction.ts:60`) | — |
| Корпоративный прокси / Defender / EDR | EDR может перехватывать loopback-трафик Node; задержки. Дефолтный Defender не блокирует | Задокументировать; ничего не делать |
| Исключённые порты (Hyper-V/WSL/Docker резервируют диапазоны, `netsh int ipv4 show excludedportrange`) | Порт `0` отдаёт ОС → она выбирает не зарезервированный. Риск только при фиксированном порту (`options.port`) — на win32 `EACCES` понятно показать | Мапить `EACCES/EADDRINUSE` в читаемую ошибку |
| `stop()` зависает (P15) | `server.close()` ждёт keep-alive | Во всех трёх `stop`: `server.closeAllConnections?.()` (Node ≥ 18.2) перед/после `close()`, + `Promise.race` с таймаутом 2 с, чтобы cleanup (restore конфига) никогда не блокировался прокси. Улучшение общее, тесты `*-proxy.test.ts` расширить |
| Прокси-процесс = процесс agento | При kill agento умирает и прокси, а Claude Code остаётся без upstream | Приемлемо, т.к. tree-kill убивает и агента (§6) |
| Цикл `ANTHROPIC_BASE_URL` | Не зависит от ОС | — |

Тесты прокси (`*-proxy.test.ts`) используют `fetch` на loopback — должны проходить на Windows без изменений; если падают (напр. из-за `AbortController`/тайминга) — это отдельные баги Фазы 1.

---

## 10. Тесты

### 10.1 Принципы
1. **Платформа — параметр, не глобал.** Новый код принимает `platform?: NodeJS.Platform` (как `ShellPathResolver`). В тестах POSIX-хоста гоняем win32-ветку с `platform:'win32'`; на windows-latest — и обратно.
2. **Пути.** В коде – `node:path` (host-зависим) только там, где путь реально касается ФС. Для логики, которую нужно проверять кросс-платформенно (`toExcludePattern`, `encodeCwdForBackup`, resolve PATHEXT) принимать `pathApi: typeof path.posix | typeof path.win32` (дефолт `path`). В тестах: `describe.each([['posix', path.posix, '/my/project'], ['win32', path.win32, 'C:\\my\\project']])`.
3. **Ожидания в тестах** строить через `path.join(...)`, а не строковыми литералами `'/my/project/.claude/settings.json'` (P18). Хелпер `src/test-utils/paths.ts`: `p(...segments)` = `path.join`, `abs('my','project')` = `path.resolve(path.sep, …)`.
4. **Домашний каталог.** Не `process.env.HOME = …`, а `vi.mock('node:os', async (orig) => ({ ...(await orig()), homedir: () => FAKE_HOME }))` либо временный `HOME` **и** `USERPROFILE` вместе. Найти все такие места: `grep -rn "process.env.HOME" src --include=*.test.ts`.
5. **Условные тесты** — `it.skipIf(process.platform !== 'win32')` для интеграционных на реальных `.cmd`; `it.skipIf(process.platform === 'win32')` для тестов, использующих `/bin/sh`, `chmod`, режимы файлов (`mode & 0o777`), `kill -0`.
6. **Не терять POSIX:** golden-тест «на POSIX `spawnCommand` вызывает `node:child_process.spawn` с теми же (command,args,options)» и «`resolveExecutable` на POSIX не добавляет расширений».

### 10.2 Новые тесты (файл → кейсы)
- `src/platform/resolve-executable.test.ts`: PATHEXT порядок (`.EXE` перед `.CMD`), команда с расширением, абсолютный путь, пути с пробелами и кириллицей, кавычки в элементах PATH, `Path` vs `PATH`, `.ps1` не резолвится и даёт спец-ошибку, пустой PATH. Фикстуры во временной директории (`fs.mkdtemp`) — реальные пустые файлы `a.cmd`, `b.exe`; работает на обеих ОС при `platform:'win32'` + `path.win32`? Нет: `path.win32` с реальной ФС Linux не сработает → логику делить на «чистую» (генерация кандидатов: `candidates(cmd, env, 'win32')` → список путей, тестируется на любом хосте) и «ФС» (`firstExisting`).
- `src/platform/spawn.test.ts`: мок `cross-spawn`, проверка проброса опций; на win32-хосте — интеграция: создать во `tmp` каталог с пробелом и `echo-args.cmd` (`@echo %*`) и `echo-args.exe`-подобный `node` скрипт; убедиться, что `spawnCommand('echo-args', ['a b', '"q"', '&calc'])` печатает аргументы буквально (BatBadBut-регрессия: `&calc` не исполняется). ПРОВЕРИТЬ ожидаемое экранирование – поведение `.cmd` с `%*` и `"`/`&` нетривиально; фиксировать фактическое.
- `src/platform/env.test.ts`: `setEnvCI` не оставляет двух ключей; POSIX-случай не меняется.
- `src/platform/kill-tree.test.ts`: на win32 — спавнит `cmd /c "ping -n 30 127.0.0.1 > nul"` (дерево из 2 процессов), `killTree` → оба мертвы (проверка через `tasklist /FI "PID eq N"`); на POSIX — ветка `child.kill`.
- `src/launcher/child.test.ts` (расширить): `platform:'win32'` — SIGINT игнорируется первый раз; второй в окне → `killTree`; `SIGHUP`/`SIGBREAK` → `killTree` + cleanup ровно один раз; ENOENT → cleanup + код 1; cleanup вызывается при любом исходе (property-style по списку исходов). Использовать фейковый `ChildProcess` (EventEmitter) — уже есть образец в существующих тестах (452 строки).
- `src/launcher/transaction.test.ts`: win32 env с `Path` → на выходе ровно один ключ, значение = resolved; `NO_PROXY` merge при `http_proxy`.
- `src/launcher/shell-path-resolver.test.ts`: покрыть win32 (разделитель `;`, `Path`/`PATH`, дедуп, фолбэк-каталоги из §5.3 с `existsSync` моком, `invalidate`), а POSIX-сценарии оставить, но не запускать с реальным `execFile` на win32-хосте (`skipIf`). Реестровое чтение (`reg query`) — парсер как чистая функция + фикстуры вывода.
- `src/installers/*.test.ts`: для каждого из 9 — таблица `platform × (checkInstalled ENOENT / ok / bad exit / timeout)`; `kimi` win32 не вызывает `bash` и `curl`; `copilot/goose` win32 не вызывают `brew`; `goose` win32 → manual-only. `npm.test.ts` (90 строк) расширить: win32 использует `spawnCommand`.
- `src/config/atomic-write.test.ts` (нового нет — добавить): ретраи на `EPERM` (мок `rename` бросает дважды, на третий ок), не ретраит `ENOENT`, чистит tmp при финальной ошибке, POSIX = 1 попытка.
- `src/config/store.test.ts`: `encodeCwdForBackup` для `C:\Proj`/`c:\proj` (одинаковый ключ), UNC, `CON`, длинный путь → хеш; POSIX-снапшот без изменений.
- `src/config/git-exclude.test.ts`: `path.win32`-кейсы (§7.2).
- `src/launcher/backup-recovery.test.ts` (Фаза 4): stale pid → автовосстановление; живой pid → ошибка как раньше.
- `bin` smoke: `spawnSync(process.execPath, ['dist/bin/agento.js','--version'])` и «без TTY → exit 2».
- Интеграционный набор `src/launcher/integration.test.ts` (423 строки, уже есть): ПРОВЕРИТЬ, как он спавнит — если через `sh`, перевести фейковых агентов на `process.execPath <script.mjs>` (кроссплатформенно) и добавить вариант с `.cmd`-шимом (`it.skipIf(!win)`).

### 10.3 Анти-флейк
Windows-медленнее: таймауты по умолчанию vitest (5 с) для интеграционных с `cmd.exe`/`taskkill` поднять до 20 с точечно (`{timeout: 20_000}`), не глобально. Временные каталоги удалять с `rm(..., {recursive:true, force:true, maxRetries:5, retryDelay:100})` (Windows держит дескрипторы).

---

## 11. CI (`.github/workflows/ci.yml`)

Изменения:

```yaml
jobs:
  test:
    name: ${{ matrix.os }} / node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['18', '20', '22']
        exclude:
          - { os: windows-latest, node: '18' }        # Windows: 20 и 22; Node 18 проверяем сборкой на ubuntu
    defaults:
      run:
        shell: bash                                   # единый синтаксис на всех ОС (Git Bash есть на раннерах)
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - name: Test
        if: matrix.node != '18'
        run: npm test
      - run: npm run build
      - name: Smoke (bash)
        run: node dist/bin/agento.js --version
      - name: Smoke (native shell)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          node dist\bin\agento.js --version
          node dist\bin\agento.js agent status
      - name: Smoke (cmd.exe shim)
        if: runner.os == 'Windows'
        shell: cmd
        run: |
          npm pack --silent
          for %%f in (emaxe-agento-*.tgz) do npm i -g %%f
          agento --version
```

Пояснения:
- **Блокирующий:** убрать `experimental` и `continue-on-error`; перед этим Фазы 0–3 должны довести job до зелёного. Branch protection: добавить обязательные чеки `windows-latest / node 20` и `… / 22`.
- **Node 18 на Windows** не гоняем (vitest 4 требует ≥ 20.12, как и на остальных ОС — `ci.yml:44-46`); сборка Node 18 остаётся на ubuntu/macos. Если нужна гарантия «CLI запускается на Node 18 в Windows» — отдельный лёгкий job: build на Node 20, затем `node dist\bin\agento.js --version` на Node 18 (без тестов).
- **Shell.** На `windows-latest` дефолтный `run`-shell — `pwsh`; `bash` на раннере — Git Bash (MSYS), в котором `$VAR`, `&&` и пути ведут себя POSIX-образно. Единый `bash` убирает расхождения в синтаксисе, а реальный нативный запуск проверяют отдельные шаги `pwsh`/`cmd` (там самый ценный сигнал: глобальный shim `agento.cmd` из `npm i -g`).
- **Кэш npm:** `cache: npm` у `setup-node` корректен на Windows (кэш `~\AppData\Local\npm-cache`); ключ по `package-lock.json`. Убедиться, что lockfile генерируется без платформенно-специфичных optional-зависимостей, иначе `npm ci` на Windows падает (ПРОВЕРИТЬ после добавления `cross-spawn`).
- `.gitattributes` (новый файл в репо): `* text=auto eol=lf` и `*.cmd text eol=crlf`. Иначе `actions/checkout` на Windows выдаёт CRLF, что ломает Prettier (`endOfLine` по умолчанию `lf`) и тесты с фикстурами/снапшотами.
- **Timeout** job: `timeout-minutes: 15` (Windows раннеры медленнее; сейчас прогон ~1 мин).
- Запуск ESLint на Windows: `eslint src bin` — без кавычек/глобов, ок. Prettier-скрипт использует `\"src/**/*.{ts,tsx}\"` — в `cmd` кавычки с `\"` работают через npm; ПРОВЕРИТЬ `npm run format` на Windows (не в CI).
- `audit`-job оставить на ubuntu.
- Артефакты при падении: `actions/upload-artifact` для `vitest` junit-репорта (`--reporter=junit --outputFile=…`) — упростит диагностику Windows-падений (отсутствие логов было проблемой при подготовке этого плана).

---

## 12. Документация

1. `README.md` (EN) и `README.ru.md` (RU), раздел Requirements: убрать «Windows is not supported today» (`README.md:45-49`); заменить на: поддерживаемые ОС/терминалы (Windows 10 1809+/11, Windows Terminal/PowerShell/cmd; Node ≥ 20 рекомендуется), матрицу установки агентов на Windows (из §4.2) с пометкой «manual only» для goose; раздел Troubleshooting (ExecutionPolicy/`.ps1`, PATH после установки, долгие пути, `agento restore` после аварийного закрытия окна); примечание, что Codex на Windows лучше запускать в WSL (по рекомендации вендора — ПРОВЕРИТЬ).
2. `AGENTS.md`: добавить в структуру `src/platform/*`; правило «никакого прямого `child_process.spawn/spawnSync` — только `src/platform/spawn.ts`» (проверять ESLint-правилом `no-restricted-imports`/`no-restricted-syntax` на `node:child_process` вне `src/platform`); правило «`process.platform` читать только в `src/platform/*` и конструкторах с инъекцией»; список Windows-нюансов (env регистр, `homedir()`, kill-tree); в «Чеклист» — «тесты не используют литералы POSIX-путей». AGENTS.md публикуется в npm (`package.json: files`), так что формулировки — для пользователей и агентов.
3. `CHANGELOG.md`, `[Unreleased]`: **Added** — Windows support (launch of `.cmd` shims, installers via winget/npm/uv, tree kill, CI); **Changed** — `codex` uses `os.homedir()`; atomic writes retry on Windows; proxy shutdown closes connections; **Fixed** — `PATH` casing duplicate env key; independent launch propagates exit code.
4. `docs/windows-support/report.md` — итоговый отчёт (новый файл, заменяет отсутствующий `windows-cross-platform-report.md`): что работает/не работает, проверено на чём, известные ограничения, результаты ручного чек-листа §14, таблица путей конфигов 9 агентов на Windows.
5. **Битая ссылка.** Заменить `docs/windows-cross-platform-report.md` на `docs/windows-support/report.md` в `README.md:49` (+RU) и убрать/переписать комментарий в `ci.yml:23-27` (после снятия `experimental` комментарий исчезает).
6. **`.gitignore`.** Сейчас:
```
docs/*
!docs/backlog/
!docs/backlog/**
!docs/superpowers/
!docs/superpowers/**
```
Добавить:
```
!docs/windows-support/
!docs/windows-support/**
```
Но `docs/windows-support/runs/*` (логи `agy.json/claude.json/*.err`, служебные артефакты запусков планировщиков) публиковать не нужно → ниже строкой `docs/windows-support/runs/`. Порядок важен: исключающие правила после разрешающих. Опционально — общее правило для будущих отчётов: `!docs/*-report.md`. **Эту правку выполняет исполнитель Фазы 0, не планировщик** (сейчас `.gitignore` не менялся).

---

## 13. Фазы, зависимости, оценка, критерии приёмки

Оценка в человеко-днях (ч-д), без учёта ожидания CI/ревью; допущение — один разработчик с доступом к Windows 11 (физически или VM). Без реальной Windows-машины Фазы 2, 5, 6 растягиваются на +50% из-за цикла «push → CI».

| Фаза | Содержание | Зависит от | Оценка |
|---|---|---|---|
| **0. Диагностика и подготовка** | воспроизвести 10 падений (получить логи через `upload-artifact`/`gh run view`), `.gitattributes`, правка `.gitignore`, перенос ссылки в README, добавить `cross-spawn`+`@types/cross-spawn` | — | 0.5 |
| **1. Платформо-независимость тестов** | `src/test-utils/paths.ts`, перевод литералов путей на `path.join`, мок `homedir`, `skipIf`; окончательно починить 10 тестов; windows-job → матрица 20/22, всё ещё `continue-on-error` | 0 | 1.5 |
| **2. Слой `src/platform/*` и запуск** | `spawn.ts`, `resolve-executable.ts`, `env.ts`, `kill-tree.ts`; замена вызовов в `child.ts`, `bin/agento.ts`, `launch.ts`, правки `transaction.ts` (env), ESLint-запрет прямого `child_process`; unified `runChildProcess` | 1 | 3 |
| **3. Установка и детект + пути конфигов** | `installers/*` (npm/copilot/goose/kimi), `checkInstalled` через `spawnCommand`, `reason`, параллельная проверка, PATH-фолбэк и reg-refresh, проверка расположения конфигов 9 агентов на Windows, `codex` `homedir()` | 2 | 3.5 |
| **4. Cleanup и надёжность** | сигнал-матрица `child.ts`, ретраи `atomic-write`, `encodeCwdForBackup`, `closeAllConnections` в proxy, восстановление после crash (pid в манифесте), `isTTY`-guard | 2 | 3 |
| **5. TUI** | ручная приёмка в WT/conhost, фиксы вставки/stdin.pause/ASCII-рамок, (опц.) разбор `.cmd` шимов в прямой `node` запуск | 2, 3 | 2 (+1 опц.) |
| **6. CI и документация** | windows блокирующий, pwsh/cmd smoke, upload-artifact, branch protection; README EN/RU, AGENTS.md, CHANGELOG, `docs/windows-support/report.md`; (опц.) ACL `icacls`, ConPTY-e2e | 1–5 | 2 (+1.5 опц.) |
| **Итого** | | | **≈ 15.5 ч-д** (+ ~3.5 опц.) |

### Критерии приёмки по фазам (проверяемые)

- **Ф0:** `git ls-files docs/windows-support` содержит планы/отчёт после правки `.gitignore`; `git check-ignore -v docs/windows-support/report.md` → пусто, `docs/windows-support/runs/x` → игнорируется; файл с логами 10 падений приложен к отчёту; `grep -rn "windows-cross-platform-report" .` → 0 совпадений.
- **Ф1:** `npm test` на windows-latest/node 20 и 22 → 0 падений; на ubuntu/macos число тестов не уменьшилось (сравнить счётчик до/после); `grep -rnE "'/(my|tmp|home)[^']*'" src --include=*.test.ts` не находит литералов путей, используемых в `expect`.
- **Ф2:** на windows-latest интеграционный тест: фейковый агент `fake-agent.cmd` в PATH с пробелом в каталоге и кириллицей в cwd запускается, получает аргументы буквально, возвращает код 7 → `launchChild` резолвится в 7; несуществующая команда → `ENOENT` (не exit 1); `grep -rn "node:child_process" src bin` вне `src/platform` и тестов → 0 (ESLint-правило зелёное); POSIX golden-тест зелёный.
- **Ф3:** на windows-latest после `npm i -g @qwen-code/qwen-code` (в тесте — на фиктивном пакете с `bin`) `checkInstalled` → `installed:true, version`; без него `reason:'not-found'`; для goose Windows-путь возвращает manual-инструкцию без вызова `brew`; kimi без `uv` → manual; таблица путей конфигов 9 агентов заполнена в `report.md`, каждая строка — «проверено на машине» / «по документации».
- **Ф4:** тест «убить дочернее дерево» зелёный (оба процесса мертвы); тест SIGINT-матрицы зелёный; `renameWithRetry` — модульный тест; симуляция crash (процесс agento убит `taskkill /F` после записи бэкапа) → следующий `agento launch` автоматически восстанавливает и пишет предупреждение; `agento` без TTY → код 2.
- **Ф5:** заполнен ручной чек-лист §14 (Windows Terminal + conhost × PowerShell + cmd) без блокирующих дефектов; скриншоты/заметки в `report.md`.
- **Ф6:** CI: все три ОС блокирующие; PR с намеренной поломкой win32-ветки краснеет (проверить один раз временным коммитом); `agento --version` проходит в pwsh и cmd; README не содержит «not supported»; ссылки в документации резолвятся (`grep` + проверка markdown-ссылок).

---

## 14. Ручной чек-лист Windows (для Ф5/приёмки)

Окружения: W11 + Windows Terminal (PowerShell 7), W10 + conhost (cmd.exe), путь профиля с пробелом и кириллицей (`C:\Users\Иван Петров`).
- [ ] `npm i -g @emaxe/agento` → `agento --version` из pwsh и cmd.
- [ ] TUI открывается, стрелки/Enter/Esc/`q`, ЙЦУКЕН-клавиши (`й`=q), resize, рамки, вставка ключа с `\r\n`.
- [ ] Добавить провайдера/профиль; `agento provider list`.
- [ ] `agento launch -p P -a claude-code` (child): агент стартует, `Ctrl+C` внутри агента не закрывает agento «до времени», выход агента → конфиг восстановлен, бэкап удалён.
- [ ] Закрыть окно консоли во время работы агента → при следующем запуске конфиг восстановлен автоматически.
- [ ] `Task Manager → End task` на agento → следующий запуск восстанавливает (после Ф4).
- [ ] independent-режим: код возврата агента пробрасывается; `agento restore -a claude-code -s global`.
- [ ] project-scope в репозитории на `D:\` с пробелом в пути: конфиг записан, `.git/info/exclude` обновлён, `git status` чист.
- [ ] Каждый из 9 агентов: «установлен/не установлен», версия; установка из визарда там, где заявлена автоустановка; manual-экран для goose.
- [ ] Прокси: запуск claude с openai-compatible провайдером; брандмауэр не показывает диалог; после выхода порт освобождён (`netstat -ano | findstr <port>`).
- [ ] Путь >260: проект глубиной ~280 символов → понятная ошибка или успешная работа (при `LongPathsEnabled`).

---

## 15. Риски и принципиальные ограничения

**Принципиально не поддерживаем / «нельзя»:**
1. `.ps1`-only команды при `Restricted/AllSigned` ExecutionPolicy — обход политики не делаем; понятная ошибка и инструкция (§3.5).
2. Graceful-завершение консольного агента из agento: у Windows нет канала доставки «SIGTERM»; поддерживается только жёсткий tree-kill. Агент, не завершившийся по собственному Ctrl+C, убивается принудительно.
3. Восстановление конфига после необработываемого kill agento (Task Manager, BSOD, потеря питания) — только отложенное, при следующем запуске (Ф4), не мгновенное.
4. Шифрование ключей в конфигах агентов (§7.3).
5. Goose: автоустановка не заявляется (нет верифицированного неинтерактивного канала).
6. Windows < 10 1809, conhost на растровом шрифте — рамки могут быть нечитаемы (деградация, не блокер).

**Риски реализации:**

| Риск | Вероятность / влияние | Митигация |
|---|---|---|
| Экранирование `cmd.exe` (BatBadBut) | средняя / высокое (инъекция) | cross-spawn ≥ актуальный (pin `^7.0.6`+), аргументы только из белого списка/без пользовательского ввода, регрессионный тест `&calc` |
| «Terminate batch job (Y/N)?» на Ctrl+C из-за `cmd /c x.cmd` | высокая / среднее (UX) | Ф5: прямой запуск `node cli.js` из разобранного шима; на крайний случай — документировать |
| Двойной SIGINT-semantics (игнор первого) воспринят как «зависание» | средняя / низкое | сообщение «Press Ctrl+C again to force quit» после первого игнорируемого |
| Расположение конфигов агентов на Windows отличается от `~/.config/...` | высокая / высокое (агент не видит конфиг) | §5.6, проверка по каждому агенту; тесты `configPaths` для win32 |
| Падение CI из-за медленных/флейковых Windows-тестов | средняя / среднее | точечные таймауты, `rm` с ретраями, junit-артефакты |
| Антивирус держит файл во время `rename`/`unlink` | средняя / среднее | ретраи (§7.1), понятное сообщение после исчерпания |
| Правки `encodeCwdForBackup` затрагивают POSIX | низкая / высокое (осиротевшие бэкапы) | ветвление строго по `platform==='win32'`, golden-тест на POSIX |
| Новая зависимость `cross-spawn` | низкая / низкое | обёртка позволяет заменить; `npm audit` в CI уже есть |
| Неверные имена пакетов (`opencode` vs `opencode-ai`, `@github/copilot`, winget-id) | средняя / низкое | сверить `npm view <pkg>`, `winget search` в Ф3 до кодирования |

---

## 16. Реестр непроверенных фактов («ПРОВЕРИТЬ на windows-latest»)

| # | Утверждение | Как проверить |
|---|---|---|
| V1 | Node отвергает spawn `.cmd` без shell с `EINVAL` (CVE-2024-27980) на Node 20/22 раннера | временный шаг CI: `node -e "…spawnSync('x.cmd')"`, вывести `error.code` |
| V2 | При двух ключах `Path`/`PATH` в `env` Node теряет резолвнутый | юнит на win32: `spawnSync('cmd',['/c','echo %PATH%'],{env:{Path:'a',PATH:'b'}})` |
| V3 | Тест-матрица: какие именно 10 тестов падают | CI-артефакт junit (Ф0) |
| V4 | `cmd /c x.cmd` + Ctrl+C даёт «Terminate batch job» | ручной тест с реальным `claude` |
| V5 | `taskkill /T /F` убивает всё дерево `cmd → node` и завершается < 1 с | тест kill-tree |
| V6 | `process.kill(pid, 0)` на Windows корректно различает живой/мёртвый pid | юнит на win32 |
| V7 | Поведение `stdin.pause()` + `stdio:'inherit'`: потеря первого символа | ручной чек-лист |
| V8 | Вставка `\r\n` в Ink 4 `TextField` триггерит submit | ручной чек-лист |
| V9 | Firewall не показывает диалог для `127.0.0.1` | ручной тест на интерактивной Windows |
| V10 | `icacls` на путях с кириллицей / на сетевых дисках | ручной тест |
| V11 | `TextDecoder('ibm866')` доступен в Node-билде | `node -p "new TextDecoder('ibm866').encoding"` в CI |
| V12 | Актуальные имена пакетов/winget-id (claude, copilot, opencode, kimi, uv) | `npm view`, `winget search` |
| V13 | `os.homedir()` корректен в Git Bash; `HOME` там POSIX-стиля | ручной тест в Git Bash |
| V14 | Фактические пути конфигов 9 агентов на Windows (особенно goose, opencode, kilo, kimi, pi) | установка каждого + проверка, откуда читается конфиг |
| V15 | Время `checkInstalled` ×9 через `cmd.exe` приемлемо | замер, порог ≤ 3 с суммарно параллельно |

---

## 17. Сводный чек-лист приёмки «полной поддержки»

- [ ] CI: windows-latest × Node 20, 22 блокирующие и зелёные; pwsh/cmd smoke зелёные.
- [ ] Все 9 агентов: корректный `checkInstalled` на Windows; установка автоматическая там, где заявлена, и честный manual-экран иначе.
- [ ] `launch` (child/independent) и TUI запускают `.cmd`/`.exe`-агентов, коды возврата и ENOENT корректны.
- [ ] Конфиг агента восстановлен при: нормальном выходе, ошибке запуска, Ctrl+C, Ctrl+Break, закрытии окна; после hard-kill — при следующем запуске.
- [ ] `PATH`/`Path` без дублей; `homedir()` вместо `HOME`; PATH обновляется после установки.
- [ ] `atomic-write` с ретраями; backup-ключ cwd регистронезависим и безопасен по длине/именам.
- [ ] Прокси: loopback only, `stop()` не блокирует cleanup.
- [ ] Прямых `child_process`-вызовов вне `src/platform` нет (ESLint).
- [ ] Тесты не содержат POSIX-литералов путей; POSIX-поведение подтверждено golden-тестами.
- [ ] README (EN/RU), AGENTS.md, CHANGELOG, `docs/windows-support/report.md` обновлены; битая ссылка устранена; `.gitignore` пропускает `docs/windows-support/**` (кроме `runs/`).
- [ ] Ручной чек-лист §14 пройден и приложен к отчёту.
