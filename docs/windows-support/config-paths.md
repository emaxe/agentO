# Пути конфигов агентов на Windows

Дата исследования: 2026-10-18. Источники: только официальные документы и репозитории вендоров.
Если документация молчит - так и написано. Статус `подтверждено документацией` ставится только когда
Windows-путь или правило его вычисления явно описаны в официальном источнике.

Обозначения: `~` = домашний каталог пользователя (`%USERPROFILE%` на Windows, т.е. `os.homedir()` в Node).

| агент | текущий путь в коде | ожидаемый на Windows | env-override | источник (URL) | статус |
|---|---|---|---|---|---|
| claude-code | global `~/.claude/settings.json` (`join(homedir(), '.claude', 'settings.json')`); project `.claude/settings.json` | `%USERPROFILE%\.claude\settings.json`; project `.claude\settings.json` | `CLAUDE_CONFIG_DIR` (переносит каталог настроек, сессий и плагинов); в коде не учитывается | https://code.claude.com/docs/en/settings ("On Windows, `~/.claude` means `%USERPROFILE%\.claude`. To keep the home-directory files somewhere else, set `CLAUDE_CONFIG_DIR`") | подтверждено документацией |
| opencode | global `~/.config/opencode/config.json`; project `opencode.json` | `%USERPROFILE%\.config\opencode\opencode.json[c]` (XDG-подобный путь под home, не `%APPDATA%`) | `OPENCODE_CONFIG` (файл), `OPENCODE_CONFIG_DIR` (каталог); `XDG_CONFIG_HOME` действует через `xdg-basedir`, но в доках opencode не описан | https://opencode.ai/docs/troubleshooting/ ("paste `%USERPROFILE%\.config\opencode\opencode.jsonc`"); https://opencode.ai/docs/config/ (env `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`; global `~/.config/opencode/opencode.json`); https://github.com/sindresorhus/xdg-basedir/blob/main/index.js (`env.XDG_CONFIG_HOME \|\| path.join(homeDirectory, '.config')`, без проверки платформы) | директория подтверждена документацией; имя файла `config.json` в доках не упомянуто - требует проверки на машине |
| qwen | global `~/.qwen/settings.json`; project `.qwen/settings.json` | `%USERPROFILE%\.qwen\settings.json`; project `.qwen\settings.json` (докс Windows-путь user-настроек явно не пишет; явно только system: `C:\ProgramData\qwen-code\settings.json`) | `QWEN_HOME` (глобальный каталог, по умолчанию `~/.qwen`), `QWEN_RUNTIME_DIR` (логи/сессии); в коде не учитываются | https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/ | `~/.qwen`, `QWEN_HOME`: подтверждено документацией; конкретно `%USERPROFILE%\.qwen`: требует проверки на машине |
| codex | global `join(process.env.HOME ?? homedir(), '.codex', 'config.toml')` (также `~/.codex/default.config.toml` для профиля); project `.codex/config.toml` | `%USERPROFILE%\.codex\config.toml`; project `.codex\config.toml` (только для trusted-проектов) | `CODEX_HOME` (корень всего state: config, auth, логи; каталог должен существовать); в коде не учитывается. `HOME` на Windows обычно не задан, поэтому сработает fallback на `homedir()` | https://learn.chatgpt.com/docs/config-file/environment-variables ("Sets the root for Codex state, including config, auth, logs, sessions, skills..."); https://learn.chatgpt.com/docs/config-file/config-basic ("`~/.codex/config.toml`"); исходник https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs (`find_codex_home`: `CODEX_HOME`, иначе `~/.codex`) | `~/.codex` и `CODEX_HOME`: подтверждено документацией; `%USERPROFILE%` явно только в сторонних источниках - требует проверки на машине |
| copilot (GitHub Copilot CLI) | global `~/.copilot/settings.json`; project `.copilot/settings.json` (запуск env-only, файл не пишется) | `%USERPROFILE%\.copilot\settings.json` (в доках пример `C:\Users\YOUR-USER\.copilot\permissions-config.json`) | `COPILOT_HOME` (меняет расположение всего каталога); в коде не учитывается | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference ("By default, this directory is `~/.copilot`"; "set the `COPILOT_HOME` environment variable") | подтверждено документацией (каталог `.copilot` под home; Windows-путь показан на примере соседнего файла) |
| goose | global `~/.config/goose/config.yaml`; project `.goose/config.yaml` | `%APPDATA%\Block\goose\config\config.yaml` (через `etcetera::choose_app_strategy`, org "Block") | `GOOSE_PATH_ROOT` (абсолютный путь; конфиг тогда в `<root>\config\`); в коде не учитывается | https://goose-docs.ai/docs/guides/config-files ("Windows: `%APPDATA%\Block\goose\config\config.yaml`"); исходник https://github.com/block/goose/blob/main/crates/goose/src/config/paths.rs (`GOOSE_PATH_ROOT`, `choose_app_strategy`, `DirType::Config => base.join("config")`) | подтверждено документацией (путь); `GOOSE_PATH_ROOT` - подтверждено только исходником, в доках не описан |
| pi (`@earendil-works/pi-coding-agent`) | global и project оба `~/.pi/agent/settings.json`; `models.json` в `~/.pi/agent/models.json` | `%USERPROFILE%\.pi\agent\settings.json` и `...\models.json` (Windows в доках не упомянут) | `PI_CODING_AGENT_DIR` (agent dir, по умолчанию `~/.pi/agent`); в коде не учитывается | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md ("defaults to `~/.pi/agent`"; "Set its location with the `PI_CODING_AGENT_DIR` environment variable"; `<agent-dir>/settings.json`, `<agent-dir>/models.json`, project `.pi/settings.json`) | требует проверки на машине (Windows в доках не описан) |
| kilo (`@kilocode/cli`) | global `~/.config/kilocode/config.json`; project `kilocode.json` | `%USERPROFILE%\.config\kilo\kilo.jsonc` (также читаются `kilo.json`, legacy `config.json`/`opencode.json[c]` в том же каталоге); project `kilo.jsonc` или `.kilo\kilo.jsonc` | `KILO_CONFIG` (доп. конфиг-файл), `KILO_CONFIG_CONTENT` (inline); `KILO_CONFIG_DIR` в доках не упомянут | https://kilo.ai/docs/getting-started/settings ("On Windows, this is `C:\Users\<username>\.config\kilo\kilo.jsonc`"); https://kilo.ai/docs/code-with-ai/platforms/cli | подтверждено документацией (и это противоречит коду, см. ниже) |
| kimi (kimi-cli) | `~/.kimi/config.toml` (канонический) и legacy `~/.kimi/config.json`; global = project | `%USERPROFILE%\.kimi\config.toml` по документации kimi-cli (Windows в доках не упомянут). Новая документация "Kimi Code CLI" называет корень `~/.kimi-code` (`C:\Users\<name>\.kimi-code`) | kimi-cli: `KIMI_SHARE_DIR` (по умолчанию `~/.kimi`); новая версия: `KIMI_CODE_HOME` (по умолчанию `~/.kimi-code`); в коде не учитываются | https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/docs/en/configuration/data-locations.md и https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/src/kimi_cli/share.py (`Path.home() / ".kimi"`, `KIMI_SHARE_DIR`); https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html ("The default data root is `~/.kimi-code/`") и https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars | требует проверки на машине (две версии документации расходятся) |

## Примечания

- Для Node-приложений (claude, qwen, codex, copilot, pi, kilo, opencode) "домашний каталог" на Windows - это `%USERPROFILE%`
  (`os.homedir()`), поэтому `join(homedir(), '.xxx')` корректно даёт `C:\Users\<name>\.xxx`. Проблемы возникают
  не с home, а с (а) именем каталога/файла, (б) env-override, (в) `process.env.HOME` в codex.
- opencode и kilo используют `xdg-basedir`, который не различает платформы: на Windows это `%XDG_CONFIG_HOME%` или
  `%USERPROFILE%\.config`, а не `%APPDATA%`. Это подтверждается и доками opencode (`%USERPROFILE%\.config\opencode\...`),
  и доками Kilo (`C:\Users\<username>\.config\kilo\kilo.jsonc`). Kilo сам отмечает "Windows config dir may vary" на CLI-странице.
- codex: `process.env.HOME ?? homedir()` на Windows даст `homedir()`, если `HOME` не задан (в Git Bash/MSYS `HOME` может быть
  задан и указывать на другой каталог, чем `%USERPROFILE%`). Это поведение отличается от самого codex, который использует
  `~` через home-dir крейт, а не переменную `HOME`. `CODEX_HOME` в коде нигде не читается (grep по `src/` пуст).
- Ни один адаптер не читает env-override (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `QWEN_HOME`, `PI_CODING_AGENT_DIR`,
  `GOOSE_PATH_ROOT`, `KIMI_SHARE_DIR`/`KIMI_CODE_HOME`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`). При заданном override
  AgentO будет писать не туда, откуда агент читает. Это не Windows-специфично, но на Windows чаще встречается
  (перенос профиля, OneDrive).
- goose: проектный конфиг `.goose/config.yaml` в официальной странице config-files не описан (страница рассматривает
  только user-level файл). Статус проектного пути: требует проверки на машине.
- copilot: файл `settings.json` в доках описан как "primary configuration file"; в старых версиях пользовательские
  настройки лежали в `config.json` и мигрируют в `settings.json` при старте (поиск по документации GitHub). Проектный
  `.copilot/settings.json` в прочитанной части страницы не подтверждён.
- opencode: в коде используется `config.json` (global) и `opencode.json` (project); в актуальных доках имена файлов
  `opencode.json` / `opencode.jsonc`. Читается ли legacy `config.json` в global-каталоге - документация opencode не
  говорит; у Kilo (форк) legacy `config.json` в доках упомянут явно.
- Исходники opencode (`global/index.ts`) по прямым ссылкам raw.githubusercontent.com не открылись (404), поэтому
  использование `xdg-basedir` подтверждено только косвенно (фрагмент опубликованного пакета на socket.dev и поведение
  самого `xdg-basedir`).

## Противоречия с кодом

Только явные противоречия между официальной документацией и текущим путём в коде на Windows (и не только).

1. **goose**: код использует `~/.config/goose/config.yaml`, на Windows документация требует
   `%APPDATA%\Block\goose\config\config.yaml`.
   Цитата: "Windows: `%APPDATA%\Block\goose\config\config.yaml`" - https://goose-docs.ai/docs/guides/config-files .
   Исходник: `choose_app_strategy` с `top_level_domain: "Block"`, `author: "Block"`, `app_name: "goose"` и
   `DirType::Config => strategy.config_dir()` - https://github.com/block/goose/blob/main/crates/goose/src/config/paths.rs .
   Следствие: `readConfig`/`snapshotConfigFiles` на Windows смотрят в несуществующий путь. (Сейчас `writeConfig` goose - no-op,
   поэтому эффект только на чтение/статус.)
   **Исправлено в Stage C:** `GooseAdapter` на win32 возвращает `%APPDATA%\Block\goose\config\config.yaml`
   (fallback `<home>\AppData\Roaming`); POSIX-путь не менялся. `GOOSE_PATH_ROOT` не учитывается.

2. **kilo**: каталог и имена файлов в коде не совпадают с документацией на всех платформах (не только Windows).
   Код: `~/.config/kilocode/config.json`, project `kilocode.json`.
   Документация: "Kilo reads JSONC config from a global location (`~/.config/kilo/kilo.jsonc`)", "On Windows, this is
   `C:\Users\<username>\.config\kilo\kilo.jsonc`", project: "`kilo.jsonc` in your project root, or `.kilo/kilo.jsonc`"
   - https://kilo.ai/docs/getting-started/settings . Legacy-имена (`kilo.json`, `opencode.json[c]`, `config.json`)
   читаются только "in the same locations", т.е. в `~/.config/kilo/`; имя `kilocode.json` в доках не встречается, а
   `~/.config/kilocode/` не упомянут. Кроме того: "Kilo no longer falls back to opencode configuration stored in `.opencode`
   directories" (https://kilo.ai/docs/getting-started/settings).
   Следствие: записанный AgentO конфиг kilo, вероятно, вообще не читается.

3. **pi (комментарий в `src/adapters/pi.ts`)**: код утверждает "PI resolves settings.json only from its agent directory
   (~/.pi/agent/), not from the project directory" и направляет оба scope в один файл. Документация описывает проектный
   уровень: "User-level: `<agent-dir>/settings.json`; Project-level: `.pi/settings.json`" и "Project settings override
   agent-directory settings" - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md
   и https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md . Следствие: project-scope
   в коде не создаёт `.pi/settings.json`, а проектный `.pi/settings.json` пользователя перекрывает глобальные записи AgentO.
   Windows здесь не при чём.

4. **opencode (имя файла)**: код пишет global `~/.config/opencode/config.json`, документация называет
   `~/.config/opencode/opencode.json` (и `opencode.jsonc` на странице troubleshooting) -
   https://opencode.ai/docs/config/ , https://opencode.ai/docs/troubleshooting/ . Поддержка `config.json` в доках opencode
   не подтверждена; пометка: возможное противоречие, требует проверки на машине. На Windows каталог совпадает
   (`%USERPROFILE%\.config\opencode`).

**Не исправлялось в Stage C (осознанно):** kilo и pi (расхождение затрагивает POSIX-путь и/или не подтверждено на Windows -
правка изменила бы поведение macOS/Linux), opencode (`config.json` vs `opencode.json` - нужна проверка, читает ли агент legacy-имя).

Не отнесено к противоречиям, но требует проверки: kimi (две версии документации: `~/.kimi` + `KIMI_SHARE_DIR` для
kimi-cli и `~/.kimi-code` + `KIMI_CODE_HOME` для "Kimi Code CLI"; какой именно ставит `https://code.kimi.com/install.sh`
- не установлено), codex (`CODEX_HOME` и `HOME`), env-override у всех агентов.
