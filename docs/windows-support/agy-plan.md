# План полной поддержки Windows для AgentO

## 1. Цель и границы

### 1.1. Цель
Обеспечить полную нативную поддержку операционной системы Windows (Windows 10/11 x64 и ARM64) в AgentO версии 0.9.x / 1.0.0 с достижением 100% функционального паритета с macOS и Linux:
1. Запуск всех 9 поддерживаемых агентов (`claude-code`, `opencode`, `qwen`, `codex`, `copilot`, `goose`, `pi`, `kilo`, `kimi`) в режимах `child` и `independent` без ошибок `ENOENT`.
2. Корректное определение установленной версии (`checkInstalled`) и установка через нативные пакетные менеджеры Windows (`npm`, `winget`, `uv`/`pip`) либо честные платформенные инструкции.
3. Гарантированная транзакционность конфигов: создание бэкапа перед модификацией и автоматический откат (restore) при любом сценарии завершения (нормальный выход, ошибка, Ctrl+C, Ctrl+Break, закрытие окна консоли).
4. Корректная работа TUI (Ink/React) в Windows Terminal, ConHost (`cmd.exe`) и интегрированных терминалах (VS Code, Cursor), включая поддержку горячих клавиш в русской раскладке ЙЦУКЕН.
5. Зеленый, **блокирующий** CI-прогон на платформе `windows-latest` для Node.js 20 и 22.

### 1.2. Границы (In-Scope / Out-of-Scope)

| Входит в границы (In-Scope) | Не входит в границы (Out-of-Scope) |
|---|---|
| Нативный запуск на Windows без требований WSL, MSYS2 или Cygwin. | Работа в среде WSL (внутри WSL AgentO работает как на обычном Linux). |
| Автоматический резолвинг `.cmd`/`.bat`/`.exe` исполняемых файлов менеджеров пакетов npm, pnpm, yarn, winget, uv. | Обход строгой системной политики PowerShell `ExecutionPolicy Restricted` (не запускаем `.ps1`, опираемся на `.cmd` и `.exe`). |
| Корректное завершение дерева процессов на Windows через `taskkill /T /F` при получении сигналов прерывания. | Использование Windows DPAPI для шифрования конфигов агентов (агенты требуют открытый JSON/TOML/YAML). |
| Механизм повторных попыток (retry-backoff) при атомарной перезаписи файлов для защиты от блокировок антивирусами и поисковыми индексаторами. | Поддержка устаревших неподдерживаемых версий Windows (Windows 7/8/XP). |
| Поддержка путей с пробелами, разными буквами дисков (`C:`, `D:`) и нормализация регистра переменных окружения (`Path` vs `PATH`). | Модификация сторонних CLI-агентов (если сам агент не умеет работать на Windows, агент объявляется неподдерживаемым на Windows на уровне документации). |

---

## 2. Карта проблем в кодовой базе (файл : строка)

Ниже сведены все места в коде, содержащие несовместимости с Windows:

| № | Файл и строка | Суть проблемы на Windows | Влияние |
|---|---|---|---|
| 1 | `bin/agento.ts:41-45` | Вызов `spawn(command, args, { stdio: 'inherit', env })` с неразрешенным именем команды. | `agento` в интерактивном TUI падает с `ENOENT` при запуске любого npm-агента. |
| 2 | `src/launcher/child.ts:52-57` | Вызов `spawn(execReq.command, execReq.args, { shell: false, ... })`. | `agento launch -m child` падает с `ENOENT`. |
| 3 | `src/cli/commands/launch.ts:125` | Вызов `spawnSync(execReq.command, execReq.args, { stdio: 'inherit', ... })`. | `agento launch -m independent` падает с `ENOENT`. |
| 4 | `src/launcher/child.ts:75-76, 87-101` | Обработка сигналов через `process.on('SIGTERM')`, `process.on('SIGINT')` и завершение через `child.kill('SIGKILL')`. | На Windows нет `SIGTERM`/`SIGKILL`. `child.kill()` вызывает `TerminateProcess`, убивая только родительский процесс-обертку (`cmd.exe`), оставляя процесс агента (`node.exe`) зомби в фоне. При закрытии окна терминала не слушаются события `SIGBREAK`/`SIGHUP`. |
| 5 | `src/installers/npm.ts:31` | `spawnSync(config.command, ['--version'], { encoding: 'utf8' })` без расширения. | `checkInstalled` всегда возвращает `installed: false` для всех npm-агентов (`claude`, `opencode`, `qwen`, `codex`, `pi`, `kilo`). |
| 6 | `src/installers/npm.ts:42, 53, 81, 109` | `spawnSync('npm', ...)` и `spawn('npm', ...)` без разрешения `.cmd`. | Установка, обновление и удаление через TUI Install Wizard падают с ошибкой `ENOENT: spawn npm ENOENT`. |
| 7 | `src/installers/copilot.ts:16, 28, 54` | `spawnSync('copilot', ...)` без расширения; проверка и установка через `brew`. | На Windows Homebrew отсутствует. Установка невозможна, `checkEnvironment` рапортует об отсутствии `brew`, ручные инструкции содержат команду `brew install`. |
| 8 | `src/installers/goose.ts:16, 28, 54` | `spawnSync('goose', ...)` без расширения; `spawn('brew', ...)`. | На Windows Homebrew отсутствует. Не используется доступный на Windows `winget install Block.Goose`. |
| 9 | `src/installers/kimi.ts:24, 36-37, 60, 88` | `spawnSync('kimi', ...)`; скрипт `curl ... | bash` через `spawn('bash')`. | `bash` отсутствует в стандартной Windows. Установка падает, ручные инструкции некорректны для CMD/PowerShell. |
| 10 | `src/adapters/codex.ts:59, 86` | Использование `process.env.HOME ?? homedir()`. | На Windows `HOME` обычно не определен (используется `USERPROFILE`). Если в среде присутствует некорректный POSIX `HOME` (например от Git Bash), путь становится битым. |
| 11 | `src/launcher/transaction.ts:51-56, 95` | `cleanProcessEnv()` копирует ключи as-is, затем добавляет `PATH: resolvedPath`. | В Windows регистр переменных окружения нечувствителен, но объект JS чувствителен. Если в `process.env` был `Path`, в объекте появляются и `Path`, и `PATH`, что приводит к конфликтам в libuv. |
| 12 | `src/config/atomic-write.ts:15-16` | `writeFile(tmp, content, { mode: 0o600 })` и `rename(tmp, filePath)`. | `0o600` на Windows — no-op. `rename` падает с `EPERM`/`EBUSY`, если файл удерживается антивирусом или индексатором. |
| 13 | `src/tui/use-key-input.ts:4-31` | Таблица `RU_TO_EN` содержит только строчные буквы `й..ь`. | При вводе с заглавной буквы (с зажатым Shift или CapsLock) подтверждения `y`/`n` в диалогах не срабатывают на русской раскладке. |
| 14 | `src/proxy/anthropic-scrubber.ts:140-144` (и др. прокси) | `server.close()` без принудительного закрытия соединений. | Открытые HTTP Keep-Alive соединения от агента могут блокировать остановку процесса AgentO. |
| 15 | `src/launcher/shell-path-resolver.test.ts:52-107` | Тесты вызывают `new ShellPathResolver()` без аргументов. | На хосте Windows `_platform` становится `'win32'`, тесты выполняют win32-ветку вместо POSIX-веток, падают 5 проверок. |
| 16 | `src/adapters/*.test.ts` (`qwen:49`, `goose:88`, `copilot:88`, `codex:50`, `claude-code:98`) | Хардкод POSIX-разделителей в проверках путей вида `expect(paths.project).toBe('/my/project/...')`. | Тесты падают на Windows, так как `path.join` формирует пути с обратными слэшами `\my\project\...`. |
| 17 | `.github/workflows/ci.yml:28-31` | `windows-latest` помечен `experimental: true` и `continue-on-error: true`. | Поломки под Windows не блокируют слияние PR. |
| 18 | `.gitignore:6` | Шаблон `docs/*` исключает все файлы в `docs/`, кроме `backlog` и `superpowers`. | Отчеты и документы по Windows (включая `docs/windows-cross-platform-report.md`) не попадают в git. |

---

## 3. Анализ вариантов решений и выбор архитектуры

### 3.1. Запуск агентов: резолвинг исполняемых файлов (.cmd / .bat / .exe)

#### Анализ альтернатив

1. **Вариант 1: Библиотека `cross-spawn` (npm)**
   - *Механизм:* Сторонняя зависимость перехватывает `spawn`, резолвит команду и запускает `.cmd`/`.bat` через `cmd.exe /d /s /c`.
   - *Плюсы:* Готовое решение, минимальный код в кодовой базе.
   - *Минусы:*
     - Дополнительная внешняя runtime-зависимость.
     - История уязвимостей безопасности (CVE-2024-21538, CVE-2024-48910 — уязвимости экранирования аргументов при вызове командного процессора Windows).
     - Не возвращает путь к найденному файлу (нельзя диагностировать, какой именно бинарник был найден).
     - Не решает проблему закрытия дерева дочерних процессов (Process Tree Kill) при прерывании.

2. **Вариант 2: Флаг `{ shell: true }` (или `{ shell: process.platform === 'win32' }`)**
   - *Механизм:* Встроенный в Node.js механизм запуска через командную оболочку.
   - *Плюсы:* Отсутствие внешних библиотек.
   - *Минусы:*
     - **Критический риск безопасности и ошибок экранирования**: Node.js выполняет конкатенацию `command` и `args` в одну строку. Спецсимволы `&`, `|`, `<`, `>`, `^`, `%`, пробелы и кавычки в аргументах или путях приводят либо к синтаксическим ошибкам `cmd.exe`, либо к выполнению произвольного кода (официальное предупреждение Node.js Security Advisory CVE-2024-27980).
     - При вызове `child.kill()` завершается только процесс `cmd.exe`, а реальный процесс агента продолжает работать в фоне.

3. **Вариант 3: Собственный типизированный резолвер команд `executable-resolver.ts` + прямое выполнение (РЕКОМЕНДУЕМЫЙ ВЫБОР)**
   - *Механизм:*
     1. Модуль `src/launcher/executable-resolver.ts` принимает команду (`command`), аргументы (`args`) и окружение (`env`).
     2. На POSIX возвращает команду без изменений.
     3. На Windows ищет файл в каталогах из `PATH` (полученного из `shellPathResolver`), проверяя расширения из `PATHEXT` (по умолчанию: `.com`, `.exe`, `.bat`, `.cmd`).
     4. **Если найден `.exe` или `.com`:** запускает его **напрямую** с `shell: false`! Это исключает прослойку `cmd.exe`, ускоряет запуск, исключает проблемы с экранированием шелла и дает прямой PID процесса.
     5. **Если найден `.cmd` или `.bat`:** запускает через `process.env.ComSpec || 'cmd.exe'` с флагами `['/d', '/s', '/c']`, строгим экранированием аргументов, флагом `windowsHide: true` и `windowsVerbatimArguments: true`.
     6. **Если файл не найден:** бросает информативную ошибку с перечислением проверенных путей.
   - *Обоснование выбора:*
     - Полная безопасность (zero vulnerability footprint).
     - Отсутствие внешних зависимостей.
     - Прозрачность: система точно знает, запускается ли нативный `.exe` или `.cmd`-шим.

---

### 3.2. Управление жизненным циклом и Process Tree Kill на Windows

На Windows отсутствует концепция сигналов POSIX. Вызов `subprocess.kill('SIGTERM')` или `subprocess.kill('SIGKILL')` в Node.js транслируется в системный вызов Win32 `TerminateProcess(hProcess, exitCode)`. 

**Опасность:** `TerminateProcess` завершает исключительно целевой процесс. Если агент запущен через `.cmd`-шим (то есть процесс верхнего уровня — `cmd.exe`), `cmd.exe` мгновенно погибает, а порожденный им процесс `node.exe` (сам агент) продолжает выполняться в фоне, удерживая файлы конфига и сокеты!

**Решение:**
1. Создать утилиту `src/launcher/process-tree.ts`.
2. Функция `killProcessTree(pid: number)`:
   - На POSIX: вызов `process.kill(-pid, signal)` (если процесс запущен в собственной process group) либо `child.kill(signal)`.
   - На Windows: вызов системной команды Windows `taskkill.exe /T /F /PID <pid>`:
     - `/T` (Tree kill) — принудительно завершает указанный процесс и все дочерние процессы, порожденные им.
     - `/F` (Force) — безусловное завершение.
3. В `src/launcher/child.ts`:
   - Подписаться на события: `SIGINT` (Ctrl+C), `SIGBREAK` (Ctrl+Break), `SIGHUP` (закрытие консоли).
   - При срабатывании сигнала на Windows вызывать `killProcessTree(child.pid)`.
   - В функции `settle()` гарантировать выполнение `cleanup()` (восстановление бэкапа конфига) ровно один раз.

---

### 3.3. Installers: матрица поддержки всех 9 агентов на Windows

| Агент | Команда | Тип дистрибутива | Способ `checkInstalled` на Windows | Способ автоустановки на Windows | Ручная инструкция (Manual) на Windows |
|---|---|---|---|---|---|
| **Claude Code** | `claude` | npm | `claude.cmd --version` | `npm install -g @anthropic-ai/claude-code` | `npm install -g @anthropic-ai/claude-code` |
| **OpenCode** | `opencode` | npm | `opencode.cmd --version` | `npm install -g opencode` | `npm install -g opencode` |
| **Qwen CLI** | `qwen` | npm | `qwen.cmd --version` | `npm install -g @qwen-code/qwen-code@latest` | `npm install -g @qwen-code/qwen-code@latest` |
| **Codex CLI** | `codex` | npm | `codex.cmd --version` | `npm install -g @openai/codex` | `npm install -g @openai/codex` |
| **PI** | `pi` | npm | `pi.cmd --version` | `npm install -g @earendil-works/pi-coding-agent` | `npm install -g @earendil-works/pi-coding-agent` |
| **Kilo Code** | `kilo` | npm | `kilo.cmd --version` | `npm install -g @kilocode/cli` | `npm install -g @kilocode/cli` |
| **Goose** | `goose` | Native Windows / WinGet | `goose.exe --version` | `winget install Block.Goose` (при наличии `winget`) | `winget install Block.Goose` или загрузка MSI/ZIP с GitHub Releases |
| **Copilot CLI** | `copilot` | Native Windows / WinGet | `copilot.exe --version` | `winget install GitHub.Copilot` (при наличии `winget`) | `winget install GitHub.Copilot` либо `gh extension install github/gh-copilot` |
| **Kimi Code** | `kimi` | Python (PyPI `kimi-cli`) | `kimi.exe --version` | `uv tool install --python 3.13 kimi-cli` (если есть `uv`) или `pip install kimi-cli` | `uv tool install --python 3.13 kimi-cli` или `pip install kimi-cli` |

---

### 3.4. Окружение и нормализация PATH / case-insensitivity

1. **Регистр переменных окружения:**
   - На Windows системная переменная путей называется `Path` (реже `PATH`).
   - Функция `cleanProcessEnv()` и подготовка `ExecRequest` должны использовать хелпер `normalizeEnv(process.env)`:
     - Все ключи приводятся к верхнему регистру при поиске коллизий.
     - Гарантируется, что в результирующем словаре присутствует ровно один ключ `PATH` (значение `Path` удаляется).
2. **`shellPathResolver`:**
   - Существующая ветка Windows разделяет пути по `;` и не вызывает login-shell.
   - Необходимо дополнить список директорий по умолчанию путями, где в Windows устанавливаются глобальные CLI-инструменты:
     - `%APPDATA%\npm`
     - `%LOCALAPPDATA%\Microsoft\WinGet\Links` (симлинки winget)
     - `%USERPROFILE%\.cargo\bin` (инструменты Rust/Goose/uv)
     - `%LOCALAPPDATA%\Programs\Python\Python*\Scripts`
3. **`codex.ts`:**
   - Заменить `process.env.HOME ?? homedir()` на `homedir()`, аналогично остальным 8 адаптерам.

---

### 3.5. Файловая система: блокировки, права и пути

1. **Защита от блокировок `rename()` в `atomic-write.ts`:**
   - В Windows вызов `fs.rename` поверх существующего файла может временно вернуть `EPERM` или `EBUSY`, если файл проверяется антивирусом (Windows Defender) или индексируется Windows Search.
   - Реализовать функцию `renameWithRetry(oldPath, newPath, retries = 5, delayMs = 20)` с экспоненциальным backoff.
2. **Права доступа и защита ключей (`mode: 0o600`):**
   - На Windows POSIX-права `0o600` игнорируются файловой системой NTFS.
   - Оценка DPAPI: **неприменимо**, так как сторонние агенты читают конфиги в виде открытого JSON/TOML.
   - Оценка `icacls`: изменение списков ACL через запуск подпроцесса на каждую запись создает задержки и не работает на FAT32/exFAT.
   - Решение: файлы в директории пользователя (`%USERPROFILE%`) в Windows защищены стандартными правами NTFS (доступ имеет только текущий пользователь и администраторы). В `atomic-write.ts` документировать поведение, вызов `chmod`/`mode` оставить безопасным no-op для Windows.
3. **Git exclude (`git-exclude.ts`):**
   - Проверен код `toExcludePattern`: он уже использует `rel.split(/[\\/]/).join('/')`, формируя валидные шаблоны с прямыми слэшами.
   - Добавить проверку ситуации, когда репозиторий и временные пути находятся на разных дисках (например, `C:` и `D:`), чтобы `path.relative` не приводил к некорректным путям.

---

### 3.6. TUI, локали и консоль Windows

1. **Windows Terminal vs ConHost:**
   - Windows Terminal (стандарт в Windows 11) нативно поддерживает UTF-8, ANSI VT100 и 24-битный цвет.
   - В ConHost (`cmd.exe`) устаревшая кодовая страница (например cp866 или cp1251) может искажать псевдографику рамок. В документацию и при старте CLI добавить рекомендацию использования Windows Terminal либо выполнения `chcp 65001`.
2. **ЙЦУКЕН маппинг (`src/tui/use-key-input.ts`):**
   - Расширить маппинг `RU_TO_EN`, добавив заглавные буквы (`Й` -> `Q`, `Ц` -> `W`, ..., `Н` -> `Y`, `Т` -> `N`), либо выполнять `RU_TO_EN[input.toLowerCase()]` с сохранением регистра.
3. **Отсутствие TTY:**
   - В `bin/agento.ts` перед запуском интерактивного цикла проверять `process.stdin.isTTY`. При запуске в неинтерактивной среде выводить понятное сообщение об ошибке с предложением использовать команды CLI (`agento launch`).

---

## 4. Пошаговые фазы реализации

### Фаза 1: Разблокировка тестового набора и инъекция платформы
- **Цель:** Устранить падение 10 существующих тестов на Windows-раннере в CI.
- **Задачи:**
  1. В `src/launcher/shell-path-resolver.test.ts` передавать `{ platform: 'darwin' }` во все тесты блока POSIX login shell.
  2. В тестах адаптеров `qwen.test.ts:49`, `goose.test.ts:88`, `copilot.test.ts:88`, `codex.test.ts:50` заменить строковый хардкод путей на `path.join('/my/project', ...)`.
  3. В `claude-code.test.ts:98` заменить `.toContain('.claude/settings.json')` на проверку регулярным выражением `/[/\\]\.claude[/\\]settings\.json/`.
- **Критерий приемки:**
  - На платформе `windows-latest` команда `npm test` завершается со статусом `0` (100% тестов проходят).
- **Оценка:** 0.5 человеко-дня.

---

### Фаза 2: Резолвер исполняемых файлов и адаптация запуска агентов
- **Цель:** Исключить ошибку `ENOENT` при запуске любых CLI-агентов на Windows.
- **Задачи:**
  1. Создать модуль `src/launcher/executable-resolver.ts`:
     - Поиск файла по `PATH` с учетом `PATHEXT`.
     - Определение формата файла (`.exe`/`.com` против `.cmd`/`.bat`).
     - Экранирование аргументов для `cmd.exe` (`escapeCmdArg`).
  2. Интегрировать резолвер в:
     - `src/launcher/child.ts` (`launchChild`)
     - `src/cli/commands/launch.ts` (`spawnSync`)
     - `bin/agento.ts` (`spawnAsync`)
  3. Покрыть unit-тестами все сценарии резолвинга (поиск `.cmd`, поиск `.exe`, пути с пробелами, аргументы с кавычками).
- **Критерий приемки:**
  - Команда `agento launch -p default -a claude-code` на Windows успешно находит и запускает `claude.cmd`.
- **Оценка:** 1.0 человеко-день.

---

### Фаза 3: Нормализация окружения и Process Tree Kill
- **Цель:** Надежный жизненный цикл процессов и 100% гарантия отката конфигов.
- **Задачи:**
  1. Реализовать `normalizeEnv()` в `src/launcher/transaction.ts`, устраняющий дубликаты `Path` и `PATH`.
  2. Создать утилиту `src/launcher/process-tree.ts` с поддержкой `taskkill /T /F /PID`.
  3. В `src/launcher/child.ts` добавить слушатели `SIGBREAK` и `SIGHUP`, вызывать `killProcessTree`.
  4. В `src/adapters/codex.ts` заменить `process.env.HOME` на `homedir()`.
- **Критерий приемки:**
  - Прерывание работы запущенного агента по Ctrl+C на Windows мгновенно гасит процесс агента и восстанавливает файл конфига из бэкапа без зависаний.
- **Оценка:** 0.5 человеко-дня.

---

### Фаза 4: Адаптация инсталлеров агентов под Windows
- **Цель:** Полноценная работа экрана установки и проверки статуса всех 9 агентов.
- **Задачи:**
  1. В `src/installers/npm.ts` вызывать `executableResolver` для `config.command` и для `npm`.
  2. В `src/installers/copilot.ts` реализовать проверку наличия `winget`, команду `winget install GitHub.Copilot` и Windows manual instructions.
  3. В `src/installers/goose.ts` реализовать поддержку `winget install Block.Goose` и ручные инструкции для Windows.
  4. В `src/installers/kimi.ts` реализовать установку через `uv tool install --python 3.13 kimi-cli` или `pip install kimi-cli`.
  5. Покрыть тестами поведение инсталлеров на win32 платформе.
- **Критерий приемки:**
  - В TUI и в CLI `agento agent status` корректно определяется статус каждого установленного агента на Windows. Экран автоустановки успешно запускает установку.
- **Оценка:** 1.0 человеко-день.

---

### Фаза 5: Надежность файловой системы и прокси-серверов
- **Цель:** Исключить сбои ввода-вывода и сетевых сокетов при работе на Windows.
- **Задачи:**
  1. В `src/config/atomic-write.ts` реализовать retry-логику для `rename` при кодах ошибок `EPERM` / `EBUSY`.
  2. Проверить `src/config/git-exclude.ts` на корректную обработку путей с разными буквами дисков.
  3. В прокси-серверах (`src/proxy/anthropic-scrubber.ts`, `openai-proxy.ts`, `responses-proxy.ts`) вызывать `server.closeAllConnections()` при вызове `stop()`.
- **Критерий приемки:**
  - 100 параллельных и последовательных операций `writeFileAtomic` на Windows завершаются без ошибок. Остановка прокси происходит мгновенно.
- **Оценка:** 0.5 человеко-дня.

---

### Фаза 6: TUI, локали и поддержка терминалов
- **Цель:** Отсутствие артефактов интерфейса и поддержка русской раскладки клавиатуры.
- **Задачи:**
  1. В `src/tui/use-key-input.ts` поддержать верхний регистр символов ЙЦУКЕН.
  2. В `bin/agento.ts` добавить проверку `process.stdin.isTTY` перед запуском Ink.
  3. Проверить отрисовку рамок и псевдографики.
- **Критерий приемки:**
  - При активной русской раскладке клавиши `Н` (Y) и `Т` (N) подтверждают и отменяют диалоги в TUI на Windows.
- **Оценка:** 0.5 человеко-дня.

---

### Фаза 7: Блокирующий CI, актуализация документации и финализация
- **Цель:** Включение строгой проверки в CI и актуализация всей документации проекта.
- **Задачи:**
  1. В `.github/workflows/ci.yml` включить `windows-latest` в общую матрицу тестирования (Node 20 и 22) без `continue-on-error`.
  2. В `.gitignore` разблокировать каталог `docs/windows-support/` и отчеты `docs/*.md`.
  3. Восстановить `docs/windows-cross-platform-report.md`.
  4. Обновить `README.md` и `README.ru.md`: удалить заявления о неподдерживаемости Windows, добавить инструкции по установке на Windows.
  5. Обновить `AGENTS.md` и `CHANGELOG.md`.
- **Критерий приемки:**
  - CI-пайплайн полностью зелёный на Linux, macOS и Windows. Ссылки в документации валидны.
- **Оценка:** 0.5 человеко-дня.

**Итоговая оценка:** **4.5 человеко-дня**.

---

## 5. Детальные изменения по файлам (с эскизами кода)

### 5.1. Новый модуль: `src/launcher/executable-resolver.ts`
*Назначение:* Кроссплатформенный резолвинг исполняемых файлов с безопасным вызовом `.cmd` и `.exe`.

```typescript
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export interface ResolvedCommand {
  readonly file: string;
  readonly args: string[];
  readonly useShell: boolean;
  readonly windowsVerbatimArguments?: boolean;
}

const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

function escapeCmdArg(arg: string): string {
  if (!/[ \t\n\v"]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function resolveExecutable(
  command: string,
  args: string[] = [],
  pathEnv: string = process.env.PATH ?? '',
  platform: NodeJS.Platform = process.platform,
): ResolvedCommand {
  if (platform !== 'win32') {
    return { file: command, args, useShell: false };
  }

  const pathext = (process.env.PATHEXT?.split(';') ?? DEFAULT_PATHEXT)
    .filter(Boolean)
    .map((ext) => ext.toUpperCase());

  const searchDirs = isAbsolute(command)
    ? ['']
    : pathEnv.split(';').filter(Boolean);

  for (const dir of searchDirs) {
    const basePath = dir ? join(dir, command) : command;
    for (const ext of pathext) {
      const candidate = basePath.toUpperCase().endsWith(ext)
        ? basePath
        : `${basePath}${ext.toLowerCase()}`;

      if (existsSync(candidate)) {
        const isBatch = candidate.toUpperCase().endsWith('.CMD') || candidate.toUpperCase().endsWith('.BAT');
        if (isBatch) {
          const comspec = process.env.COMSPEC || 'cmd.exe';
          return {
            file: comspec,
            args: ['/d', '/s', '/c', escapeCmdArg(candidate), ...args.map(escapeCmdArg)],
            useShell: false,
            windowsVerbatimArguments: true,
          };
        }
        return { file: candidate, args, useShell: false };
      }
    }
  }

  return { file: command, args, useShell: false };
}
```

---

### 5.2. Новый модуль: `src/launcher/process-tree.ts`
*Назначение:* Гарантированное завершение дерева процессов на Windows.

```typescript
import { spawnSync } from 'node:child_process';

export function killProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') {
    try {
      spawnSync('taskkill.exe', ['/T', '/F', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Игнорируем ошибку, если процесс уже завершился
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Процесс уже завершен
      }
    }
  }
}
```

---

### 5.3. Модификация `src/launcher/child.ts`
*Назначение:* Использование `resolveExecutable`, обработка событий закрытия Windows-терминала и вызов `killProcessTree`.

```typescript
// Эскиз изменений в src/launcher/child.ts (строки 50-105)
import { resolveExecutable } from './executable-resolver.js';
import { killProcessTree } from './process-tree.js';

export async function launchChild(options: ChildLaunchOptions): Promise<number> {
  const { execReq, cleanup, warnings } = await prepareChild(options);
  // ...
  const resolved = resolveExecutable(execReq.command, execReq.args, execReq.env.PATH);

  return new Promise<number>((resolve) => {
    const child = spawn(resolved.file, resolved.args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      shell: resolved.useShell,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      windowsHide: true,
      env: execReq.env,
    });

    // ...
    function handleSignal(signal: NodeJS.Signals): void {
      if (signalled) {
        killProcessTree(child.pid!);
        return;
      }
      signalled = true;
      if (process.platform === 'win32') {
        killProcessTree(child.pid!);
      } else {
        child.kill(signal);
        killTimer = setTimeout(() => child.kill('SIGKILL'), SIGNAL_EXIT_GRACE_MS);
        killTimer.unref();
      }
    }

    process.on('SIGTERM', handleSignal);
    process.on('SIGINT', handleSignal);
    if (process.platform === 'win32') {
      process.on('SIGBREAK', handleSignal);
      process.on('SIGHUP', handleSignal);
    }
    // ...
```

---

### 5.4. Модификация `src/config/atomic-write.ts`
*Назначение:* Механизм повторов при блокировках файлов и кроссплатформенная запись.

```typescript
// Эскиз изменений в src/config/atomic-write.ts
import { writeFile, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function renameWithRetry(oldPath: string, newPath: string, maxAttempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rename(oldPath, newPath);
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, attempt * 25));
        continue;
      }
      throw err;
    }
  }
}

export async function writeFileAtomic(filePath: string, content: string, mode = 0o600): Promise<void> {
  const tmp = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, content, { encoding: 'utf-8', mode: process.platform === 'win32' ? undefined : mode });
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}
```

---

### 5.5. Модификация `src/launcher/transaction.ts`
*Назначение:* Нормализация регистра переменных окружения (`Path` vs `PATH`).

```typescript
// Эскиз изменений в src/launcher/transaction.ts (строки 50-60, 90-100)
export function normalizeProcessEnv(
  source: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      if (process.platform === 'win32' && key.toUpperCase() === 'PATH') {
        continue; // Пропускаем любые вариации Path/PATH
      }
      clean[key] = value;
    }
  }
  return { ...clean, ...overrides };
}

// В buildExecRequest:
const env = withNoProxyLoopback(
  normalizeProcessEnv(process.env, { PATH: resolvedPath, ...adapterEnv }),
);
```

---

### 5.6. Модификация `src/installers/npm.ts`
*Назначение:* Поддержка резолвинга `.cmd` при проверке и вызове `npm`.

```typescript
// Эскиз изменений в src/installers/npm.ts (строки 30-60)
import { resolveExecutable } from '../launcher/executable-resolver.js';

// В checkInstalled():
const resolved = resolveExecutable(config.command, ['--version']);
const result = spawnSync(resolved.file, resolved.args, {
  encoding: 'utf8',
  shell: resolved.useShell,
  windowsVerbatimArguments: resolved.windowsVerbatimArguments,
});

// В checkEnvironment():
const resolvedNpm = resolveExecutable('npm', ['--version']);
const result = spawnSync(resolvedNpm.file, resolvedNpm.args, {
  encoding: 'utf8',
  shell: resolvedNpm.useShell,
  windowsVerbatimArguments: resolvedNpm.windowsVerbatimArguments,
});
```

---

### 5.7. Модификация `src/installers/copilot.ts` и `goose.ts`
*Назначение:* Поддержка `winget` и платформенных инструкций на Windows.

```typescript
// Эскиз изменений в src/installers/goose.ts
export class GooseInstaller implements AgentInstaller {
  readonly agentId: AgentId = 'goose';

  get manualInstructions() {
    if (process.platform === 'win32') {
      return {
        commands: ['winget install Block.Goose'],
        docsUrl: 'https://block.github.io/goose/',
      };
    }
    return {
      commands: ['brew install block-goose-cli'],
      docsUrl: 'https://goose-docs.ai/docs/getting-started/installation',
    };
  }

  async checkEnvironment(): Promise<EnvCheckResult> {
    if (process.platform === 'win32') {
      const resolved = resolveExecutable('winget', ['--version']);
      const ok = spawnSync(resolved.file, resolved.args, { encoding: 'utf8' }).status === 0;
      return ok ? { ok: true, missing: [] } : { ok: false, missing: ['winget'] };
    }
    const result = spawnSync('brew', ['--version'], { encoding: 'utf8' });
    return result.status === 0 ? { ok: true, missing: [] } : { ok: false, missing: ['brew'] };
  }
  // install() аналогично вызывает winget на win32
}
```

---

### 5.8. Модификация `src/adapters/codex.ts`
*Назначение:* Исправление путей глобального конфига Codex на Windows.

```typescript
// В src/adapters/codex.ts:59, 86
function profileConfigPath(name: string): string {
  return join(homedir(), '.codex', `${name}.config.toml`);
}

// В configPaths:
configPaths(cwd?: string): AgentConfigPaths {
  return {
    global: join(homedir(), '.codex', 'config.toml'),
    project: join(cwd ?? process.cwd(), '.codex', 'config.toml'),
  };
}
```

---

### 5.9. Модификация `src/tui/use-key-input.ts`
*Назначение:* Поддержка заглавных букв ЙЦУКЕН.

```typescript
// Эскиз изменений в src/tui/use-key-input.ts
export function useKeyInput(handler: (input: string, key: Key) => void): void {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    const mapped = RU_TO_EN[lower];
    if (mapped) {
      const isUpper = input !== lower;
      handler(isUpper ? mapped.toUpperCase() : mapped, key);
    } else {
      handler(input, key);
    }
  });
}
```

---

### 5.10. Модификация `.gitignore`
*Назначение:* Разрешить версионирование документации и отчетов в `docs/`.

```gitignore
node_modules/
dist/
*.js.map
*.d.ts
.DS_Store
docs/*
!docs/backlog/
!docs/backlog/**
!docs/superpowers/
!docs/superpowers/**
!docs/windows-support/
!docs/windows-support/**
!docs/*.md
.worktrees/
.claude/
.qwen/
.skill-hub.local.json
```

---

## 6. Тестирование

### 6.1. Исправление существующих тестов
1. `src/launcher/shell-path-resolver.test.ts`:
   - В тестах `describe('ShellPathResolver', ...)` инстанцировать `new ShellPathResolver({ platform: 'darwin' })`. Это изолирует POSIX-тесты от платформы запуска (CI Windows).
2. `src/adapters/qwen.test.ts`, `src/adapters/goose.test.ts`, `src/adapters/copilot.test.ts`, `src/adapters/codex.test.ts`:
   - Заменить `expect(paths.project).toBe('/my/project/...')` на `expect(paths.project).toBe(join('/my/project', ...))`.
3. `src/adapters/claude-code.test.ts`:
   - Использовать регулярное выражение для кроссплатформенной проверки пути:
     `expect(paths.project).toMatch(/[/\\]\.claude[/\\]settings\.json$/)`.

### 6.2. Новые специализированные тесты для Windows
1. `src/launcher/executable-resolver.test.ts`:
   - Тестирование поиска `.cmd` файлов при наличии в `PATH`.
   - Тестирование приоритета расширений (`.exe` над `.cmd`).
   - Тестирование экранирования аргументов, содержащих пробелы, кавычки и спецсимволы.
   - Тестирование возврата `useShell: false` и `windowsVerbatimArguments: true`.
2. `src/launcher/process-tree.test.ts`:
   - Мокирование `spawnSync` и проверка вызова `taskkill.exe /T /F /PID <pid>` на платформе `win32`.
3. `src/config/atomic-write.test.ts`:
   - Тестирование повторных попыток при `rename` в случае ошибок `EPERM` / `EBUSY`.
4. `src/config/git-exclude.test.ts`:
   - Проверка вычисления относительных путей при расположении репозитория на диске `C:` и целевых путей на диске `D:`.

---

## 7. Непрерывная интеграция (CI)

Обновление `.github/workflows/ci.yml`:
1. Включение `windows-latest` в основную матрицу тестирования для Node.js 20 и 22.
2. Удаление `continue-on-error: ${{ matrix.experimental == true }}` (делаем джобу Windows строго блокирующей).
3. Обеспечение кэширования npm для Windows (`cache: npm` поддерживается на `windows-latest`).

```yaml
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['20', '22']
        include:
          # Node 18 smoke check на Linux/macOS
          - os: ubuntu-latest
            node: '18'
          - os: macos-latest
            node: '18'

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        if: matrix.node != '18'
        run: npm test

      - name: Build
        run: npm run build

      - name: Smoke-check the built CLI
        run: node dist/bin/agento.js --version
```

---

## 8. Документация

1. **`README.md` и `README.ru.md`:**
   - Удалить формулировку «macOS or Linux. Windows is not supported today».
   - Добавить раздел «Поддерживаемые платформы: macOS, Linux, Windows 10/11».
   - Добавить рекомендации для пользователей Windows:
     - Рекомендуемый терминал: Windows Terminal (для наилучшего отображения TUI и шрифтов).
     - Рекомендуемая кодовая страница для ConHost (`cmd.exe`): `chcp 65001` (UTF-8).
2. **`AGENTS.md`:**
   - Обновить сводную таблицу агентов с указанием механизмов запуска на Windows (`.cmd`-шимы, `winget`, `uv`/`pip`).
3. **`CHANGELOG.md`:**
   - Добавить секцию релиза: `### Added: Full native Windows support (Process Tree Kill, shim resolver, winget/uv installers)`.
4. **`docs/windows-cross-platform-report.md`:**
   - Создать документ с описанием архитектурных особенностей кроссплатформенности и историей реализации поддержки Windows.

---

## 9. Анализ рисков и неустранимые ограничения

| Риск / Ограничение | Вероятность | Критичность | Стратегия смягчения |
|---|---|---|---|
| **PowerShell ExecutionPolicy:** У пользователя включена политика `Restricted`, блокирующая запуск `.ps1`. | Высокая | Средняя | **Принципиальный отказ от вызова `.ps1`**. Все npm-агенты запускаются через их штатные `.cmd`-шимы, которые выполняются стандартным интерпретатором `cmd.exe` независимо от политик PowerShell. |
| **Агрессивный антивирус / EDR:** Блокировка переименования файлов конфигов (`EPERM`). | Средняя | Высокая | Внедрение механизма retry-backoff в `atomic-write.ts` (до 5 попыток с задержками до 200 мс). |
| **Устаревший ConHost без UTF-8:** Искажение символов рамок в `cmd.exe`. | Средняя | Низкая | Определение кодовой страницы, информирование пользователя в документации и подсказках о переходе на Windows Terminal. |
| **Длинные пути (> 260 символов):** Ошибка `ENOENT` / `ENAMETOOLONG`. | Низкая | Средняя | Использование канонических путей Node.js `\\?\` при превышении длины и компактное кодирование путей в `src/config/store.ts`. |
| **Отсутствие прав администратора для `winget`:** Сбой автоустановки Goose/Copilot. | Средняя | Средняя | Перехват ошибки и переключение на экран ручных инструкций (Manual Instructions) с прямыми ссылками на скачивание портативных версий. |

---

## 10. Итоговый чек-лист приемки (Acceptance Checklist)

- [ ] **Тесты:** `npm test` завершается со статусом `0` на Linux, macOS и Windows.
- [ ] **Сборка и линтинг:** `npm run lint`, `npm run typecheck`, `npm run build` проходят без ошибок и предупреждений на всех платформах.
- [ ] **Запуск через CLI:** Команда `agento launch -p <profile> -a claude-code` на Windows запускает Claude Code, не падая с `ENOENT`.
- [ ] **Запуск через TUI:** В интерактивном режиме `agento` выбор агента успешно инициирует сессию в терминале.
- [ ] **Восстановление конфига (Rollback):** Прерывание агента через Ctrl+C в `child`-режиме восстанавливает исходный конфиг агента и удаляет активный бэкап.
- [ ] **Дерево процессов:** При выходе из AgentO не остается зависших фоновых процессов `node.exe` или `cmd.exe`.
- [ ] **Проверка версий (Installers):** В меню агентов корректно отображаются версии установленных CLI-утилит (например `v1.2.3`).
- [ ] **TUI раскладка:** В русской раскладке клавиатуры работают навигационные клавиши и подтверждения `Н` / `Т`.
- [ ] **CI:** Джоба `windows-latest` в GitHub Actions является обязательной (blocking) и успешно проходит для Node.js 20 и 22.
- [ ] **Документация:** README и документация обновлены, отсутствующие ссылки устранены, `.gitignore` разрешает версионирование отчетов.
