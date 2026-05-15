# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.4] - 2026-05-15

### Added

- **OpenAI-to-Anthropic Proxy** (`src/proxy/openai-proxy.ts`): локальный HTTP-proxy, транслирующий OpenAI API в формат Anthropic, — позволяет Claude Code работать с `openai-compatible` провайдерами.
  - Трансляция non-streaming ответов (OpenAI → Anthropic).
  - Трансляция streaming SSE ответов (OpenAI → Anthropic).
  - Конвертация ошибок (OpenAI errors → Anthropic errors).
  - Автоматически стартует в `prepareLaunchTransaction` для `claude-code` + `openai-compatible` провайдер (аналогично Anthropic Scrubber для `fireworks`/`openrouter`).
  - Unit tests: `src/proxy/openai-proxy.test.ts` (142 строки: non-streaming, streaming SSE, error conversion).

- **Claude Code поддерживает `openai-compatible` провайдеры**: `openai-compatible` добавлен в `supportedProviderTypes` адаптера; запросы проксируются через OpenAI-to-Anthropic proxy.

- **Поддержка системного proxy** (`src/proxy/proxy-utils.ts`): исходящие HTTP-запросы обоих proxy-серверов уважают переменные окружения `HTTP_PROXY` / `HTTPS_PROXY` / `http_proxy` / `https_proxy`. Добавлена утилита `scripts/diagnose-proxy.mjs` для диагностики конфигурации proxy.

- **Codex CLI переведён в stable**: удалён флаг `dev: true`; Codex отображается в TUI и CLI без флага `--dev`.

- **TUI рефакторинг** (`refactor(tui)`): монолитные экраны LaunchAgent, Providers, Profiles декомпозированы на отдельные sub-компоненты и custom hooks (`useLaunchWizard`, `ProfileWizard`, `ProviderForm`, `ProviderList`, `AgentSelect`, `ProfileSelect`, `ProfileList`, `ProfileDetail`, `ProfileEdit`, `SelectList`, `TextField`).

- **Anthropic Scrubber Proxy** (`src/proxy/anthropic-scrubber.ts`): локальный HTTP-proxy для Claude Code при работе через `openrouter` и `fireworks`.
  - Вырезает неподдерживаемые Anthropic-поля (например, `context_management`) из JSON-тела POST-запросов перед пересылкой на upstream.
  - Прозрачно проксирует GET-запросы и non-JSON POST без модификации.
  - Ответы pipe'ятся напрямую (SSE streaming сохраняется).
  - **Корректно сохраняет base path upstream**: `https://api.fireworks.ai/inference` + `/v1/messages` → `/inference/v1/messages`.
  - **Корректно сохраняет query parameters** (`?beta=true` и др.): ранее query string попадала в `pathname` и URL-encoded (`%3F`), что ломало Anthropic beta-endpoints.
  - Интегрирован в `prepareLaunchTransaction`: proxy стартует автоматически для `claude-code` + non-`anthropic` провайдер, заменяет `ANTHROPIC_BASE_URL` в конфиге на `http://127.0.0.1:<random_port>`, останавливается в cleanup-хуке.
  - Unit tests: `src/proxy/anthropic-scrubber.test.ts` (12 тестов).
  - Integration tests: `src/launcher/integration.test.ts` дополнен тестами на proxy-инжекцию для OpenRouter/Fireworks.

### Fixed

- **OpenCode теперь использует нативный `@ai-sdk/openai`** для реальных OpenAI API запросов (ранее ошибочно использовался `@ai-sdk/openai-compatible`); автоматически определяется, когда `baseUrl` провайдера совпадает с `https://api.openai.com/v1` или не задан для типа `openai-compatible`.
- **Codex `wire_api`**: исправлено значение по умолчанию с `'openai'` на `'responses'` для всех типов провайдеров.
- **Codex default base URL для `openai-compatible`**: добавлен дефолт `https://api.openai.com/v1` — провайдеры без явного `baseUrl` работают из коробки.
- **`baseUrl` опционален для `openai-compatible`**: провайдеры с известным дефолтом (Fireworks, OpenRouter, OpenAI) больше не требуют явного флага `-u`.
- **TUI launch deadlock**: `bin/agento.ts` использовал `spawnSync` для запуска агента после выхода из TUI. `spawnSync` блокировал event loop Node.js, из-за чего локальный proxy не мог обрабатывать HTTP-запросы от Claude Code. Заменено на асинхронный `spawn`.

## [0.4.3] - 2026-05-13

### Added

- **Conservative config merge** (`mergeAgentConfigs`, default `true`) for JSON-based agent adapters:
  - New `mergeAgentConfig(existing, generated, envKeys)` helper in `src/adapters/merge-config.ts` performs shallow top-level merge: unknown keys preserved, generated keys overwrite, nested objects replaced whole, env keys merged flat.
  - Claude Code, Qwen, and OpenCode adapters now read existing config and merge before writing when `mergeEnabled=true`. `env` keys are merged flat; all other nested objects are replaced entirely.
  - New `mergeAgentConfigs: boolean` setting added to `AgentOConfigSchema` with default `true`.
  - `AgentAdapter.writeConfig` signature extended with optional 4th parameter `mergeEnabled?: boolean`.
  - `transaction.ts` reads `settings.mergeAgentConfigs` from AgentO config and passes the flag to `adapter.writeConfig`.
  - `backup-restore.ts` continues to call `writeConfig` without `mergeEnabled`, ensuring restore performs exact replacement of the original backup.
  - Copilot and Goose adapters unaffected (env-only, `writeConfig` no-op). Codex retains its existing split-file merge logic.
  - Unit tests added for `mergeAgentConfig` helper and for merge behavior in each of the three updated adapters.

- `prepublishOnly` script now includes `node dist/bin/agento.js --version` smoke check after build.
- `writeJsonAtomic` helper in `src/config/store.ts`: writes JSON to a temp file (`.tmp-<uuid>`) with mode `0o600`, then atomically renames into place; cleans up temp on error. Used by `writeConfig`, `writeBackup`, and `writeAgentStatusCache`. `~/.agento` directory created with mode `0o700`.
- New `src/config/atomic-write.ts` module with `writeFileAtomic` and `writeJsonAtomic` extracted from `store.ts`. All adapter config writes (`claude-code`, `opencode`, `qwen`, `codex`) now use atomic writes with mode `0o600`. Backup directories (`backups/<agentId>/`) created with mode `0o700`. POSIX file mode tests added for each adapter and for the store backup path.
- New `src/launcher/integration.test.ts`: 5 end-to-end scenarios covering full child-mode cycle, config restore, second-launch guard, independent-mode backup persistence, and Codex project-scope multi-file cleanup — all using real filesystem operations with mocked `homedir` and shell resolver.
- New `src/cli/smoke.test.ts`: CLI smoke tests via `spawnSync` covering `--version`, `--help`, `launch --help`, `restore --help`; skipped automatically if `dist/bin/agento.js` is not built.
- New `src/config/validation.ts` module with `validateProvider` and `validateProfile` domain-level validation functions; called in `addProvider`, `updateProvider`, `addProfile`, `updateProfile` before any config writes. Enforces: valid provider type, `baseUrl` required for `openai-compatible`, unique names, unknown `providerId` references, multi-model tier completeness, no duplicate tiers, and at least one `base` tier in multi-model profiles.

### Changed

- Removed `"main"` and `"exports"` fields from `package.json`; package is CLI-only with no programmatic API surface.
- Removed `IndependentModeSchema`, `IndependentMode` type and `independentMode` field from `SettingsSchema`; the setting was never read by any launcher or TUI code. Removed `node-pty` optional dependency and `postinstall` chmod script. Existing `config.json` files with `independentMode` are accepted silently via Zod `.strip()`.
- Added a unified agent registry for CLI launch/status, TUI launch/status and install wizard metadata, keeping agent order, `--dev` filtering, commands, default args and installers in one source of truth.
- Backups now use a v2 manifest with `sessionId`, `createdAt`, `cwd`, touched file metadata and `hadFile` state instead of storing only the raw config object.
- Launch preparation now uses a shared transaction layer for backup creation, config writes, `ExecRequest` env/PATH assembly and cleanup across child and independent modes.

### Fixed

- CLI `launch --mode <invalid>` and `--scope <invalid>` now exit with a clear error listing allowed values before writing any configs; unsafe TypeScript casts replaced with `LaunchModeSchema.safeParse` / `LaunchScopeSchema.safeParse`.
- Removed unsafe `opts.type as ProviderType` cast from `provider add` CLI; `CreateProviderInput.type` now accepts `string` and validation enforced via `validateProvider` inside the manager.
- CLI `--dev` handling now works consistently for subcommands even when Commander stores the duplicated flag on the root command.
- `agento restore` now uses the unified agent registry, supports all registered agents including `qwen`, `codex`, `copilot`, and `goose`, validates scope through `LaunchScopeSchema`, and deletes the backup after a successful restore.
- Launch no longer silently overwrites an active backup for the same agent/scope; restore now removes generated config files when the original file did not exist.
- Codex `project` scope now uses a multi-file backup/restore transaction for both global and project TOML configs, so cleanup and crash-like `agento restore -a codex -s project` restore or remove both files without process-local backup state.

### Documentation

- `AGENTS.md`: removed `node-pty` from stack, removed `independentMode` from settings schema, added `validation.ts` and `atomic-write.ts` to project structure, added Copilot and Goose rows to adapter table, added `--version` smoke check to pre-publish checklist.
- `README.md`: removed stale `independentMode` from Settings table and config JSON example.

### Planned

- Additional agent support (continue.dev, aider, etc.)
- Profile import/export
- CLI flags for setting non-default capabilities at `provider add` time
- Plugin system for custom adapters
- Configuration templates and presets

## [0.4.2] - 2026-05-12

### Added

- **Goose agent** (`goose`) — full support for [Block's Goose](https://goose-docs.ai) CLI agent across all 4 provider types:
  - All config delivered via environment variables (`GOOSE_PROVIDER`, `GOOSE_MODEL`, plus provider-specific keys) — no config file mutation
  - Provider mapping: `anthropic` → `GOOSE_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ `ANTHROPIC_HOST` for custom endpoints); `openrouter` → `GOOSE_PROVIDER=openrouter` + `OPENROUTER_API_KEY`; `fireworks` / `openai-compatible` → `GOOSE_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_HOST`
  - Automatic `/v1` path stripping from `OPENAI_HOST` — Goose appends `/v1/chat/completions` itself; passing a URL with trailing `/v1` would produce a double-versioned path
  - Config paths: `~/.config/goose/config.yaml` (global), `./.goose/config.yaml` (project)
  - Installer: Homebrew (`brew install block-goose-cli`); `manualInstructions` point to official Goose docs
  - Registered in TUI Launch Agent screen, `agento launch`, and `agento agent status`

## [0.4.1] - 2026-05-12

### Added

- **Copilot CLI agent** (`copilot`) — full support for GitHub Copilot CLI across all 4 provider types:
  - All config delivered via environment variables (`COPILOT_MODEL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BASE_URL`) — no settings file mutation
  - Provider type mapping: `anthropic` → `anthropic`, `openai-compatible` / `fireworks` / `openrouter` → `openai`
  - Default base URLs: Anthropic `https://api.anthropic.com`, Fireworks `https://api.fireworks.ai/inference/v1`, OpenRouter `https://openrouter.ai/api/v1`
  - Auto-enables `COPILOT_PROVIDER_WIRE_API=responses` for gpt-5 family models
  - Registered in TUI Launch Agent screen and CLI `agento launch` command
  - Installer: Homebrew Cask (`gh` extension via `brew install --cask github-copilot-for-xcode` / `gh extension install github/gh-copilot`)
- **Install status disk cache** — agent install statuses persisted to `~/.agento/agent-status.json`; already-known-installed agents are skipped on next launch (no redundant `checkInstalled()` calls)
- **ENOENT recovery loop** — when `spawnSync` throws `ENOENT` (command not found), the TUI relaunches with a `launchError` context: profile is pre-selected, affected agent is marked not-installed, and the error message is shown on the agent selection step
- **Settings value descriptions** — the Settings screen now shows an inline description of the current value for the highlighted setting (e.g. explains what `child` vs `independent` mode means)
- `agentId` / `profileId` fields added to `ExecRequest` interface — allows the relaunch loop to identify which agent failed without re-parsing the command string

### Fixed

- Copilot adapter `writeConfig` no longer creates a stale empty directory — it is a true no-op since Copilot CLI needs no settings file
- Copilot adapter now throws a descriptive error when no base URL can be resolved for a provider type (previously silently set an empty string)

## [0.4.0] - 2026-05-11

### Added

- **Agent Install Wizard** — selecting an uninstalled agent in the TUI now opens an install screen instead of failing silently:
  - **Auto-install**: checks environment requirements (npm), then runs `npm install -g <package>` with a live spinner
  - **Manual install**: shows exact commands to run and a documentation URL
  - **Error recovery**: on env check failure shows missing deps with a manual install option; on install failure shows error with retry / manual options
  - Installers implemented for all 4 agents: `claude-code` (`@anthropic-ai/claude-code`), `opencode` (`opencode`), `qwen` (`@qwen/qwen-code`), `codex` (`@openai/codex`)
- **Install status preloader** in Launch Agent — on entering the agent selection step a spinner runs `checkInstalled()` for all agents in parallel; uninstalled agents display a `(not installed)` dim hint next to their name
- After successful auto-install the agent is marked installed in-session and the list returns to normal selection

## [0.3.0] - 2026-05-11

### Added

- **New provider type `openrouter`** — full support for [OpenRouter](https://openrouter.ai) across all 4 agents:
  - **Claude Code**: uses OpenRouter's Anthropic Skin with `ANTHROPIC_AUTH_TOKEN` (Bearer) + empty `ANTHROPIC_API_KEY`, no `apiKeyHelper`. Base URL: `https://openrouter.ai/api`
  - **OpenCode**: uses `@ai-sdk/openai-compatible` with provider key `openrouter`. Base URL: `https://openrouter.ai/api/v1`
  - **Qwen CLI**: routed through OpenAI-compatible interface with default URL `https://openrouter.ai/api/v1`
  - **Codex CLI**: `wire_api: 'responses'` (Responses API beta). Base URL: `https://openrouter.ai/api/v1`
- `PROVIDER_TYPES` constant exported from schema — removes literal type duplication in CLI and TUI

### Changed

- Adapter default base URLs refactored into `DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>>` map (was a chain of ternary operators) — scales to new provider types

## [0.2.0] - 2026-05-10

### Added

- **Model capability flags** (`image`, `video`, `audio`) — every model in a provider now carries modality metadata:
  - New schema types `ModelCapabilities` and `ModelConfig`. Provider model entries are objects `{ name, capabilities }` instead of bare strings.
  - Defaults: `image=true`, `video=false`, `audio=false`.
  - Capability marker `[iva]` / `[i--]` rendered before model names in TUI and CLI listings (informational only — never written into agent configs).
- **TUI hotkeys for capabilities** in Providers → Edit:
  - `i` / `v` / `a` toggle image / video / audio for the highlighted model
  - `[+ add model]` row activated by `Enter` replaces the previous `a`-to-add hotkey (avoids collision with audio toggle)
- **Qwen adapter**: now passes real `generationConfig.modalities` based on per-model capabilities (previously hardcoded to `false`).
- **OpenCode adapter**: emits per-model `modalities: { input: [...], output: ['text'] }`, including `image` / `video` / `audio` only when the corresponding capability is enabled. Applies to all three provider types (`anthropic`, `openai-compatible`, `fireworks`).
- **Lazy config migration**: configs created by older versions (with `string[]` model lists) are migrated on read into the new `ModelConfig[]` shape with default capabilities. Idempotent; written back on next save.
- **Earlier additions carried over from Unreleased:**
  - `--dev` flag across CLI and TUI for showing development agents (Codex CLI)
  - Codex CLI adapter improvements: `wire_api: 'responses'`, `default_profile` / `profiles.default` blocks, project-scope split, `buildEnv` support
  - TUI Profiles screen redesign: `a` add, `d` delete, `↑↓` navigate
  - TUI Providers screen: `Enter` on trailing row opens add form
  - Base adapter interface: optional `dev?: boolean` flag

### Changed

- `ProviderSchema.models` is now `z.array(ModelConfigSchema).min(1)` instead of `z.array(z.string()).min(1)`.
- CLI `provider list` and TUI Providers list display capability markers next to each model.
- `agento provider add -M ...` parses comma-separated model names into `ModelConfig[]` with default capabilities (toggle in TUI to change).
- Codex CLI is now marked as `dev: true` — hidden from TUI and CLI unless `--dev` is passed.
- Launch command now passes `args` (e.g. `['-p', 'default']` for Codex) to child/independent launchers.

## [0.1.2] - 2025-05-09

### Changed

- **Documentation**: Expanded README.md "Interactive TUI" section with detailed screen-by-screen guide, navigation reference, workflow examples, and TUI vs CLI comparison table

## [0.1.1] - 2025-05-09

### Changed

- Package name changed to `@emaxe/agento` for scoped npm publishing
- Fixed `bin` path format in `package.json` (removed `./` prefix for npm compliance)

## [0.1.0] - 2025-05-09

### Added

- Initial release of AgentO
- Support for 4 AI agent CLI tools:
  - Claude Code
  - OpenCode
  - Qwen CLI
  - Codex CLI
- **Profile Management**: Create profiles with single or multi-tier model configurations
- **Provider Management**: Configure API providers (OpenAI-compatible and Anthropic)
- **Interactive TUI**: Terminal User Interface built with Ink and React for easy navigation
- **CLI Commands**:
  - `agento` — Launch interactive TUI
  - `agento launch` — Launch agent with profile
  - `agento provider` — CRUD operations for providers
  - `agento profile` — CRUD operations for profiles
  - `agento agent status` — Check agent config status
  - `agento restore` — Restore agent config from backup
- **Config Scopes**: Global (`~/.agento/`) and project-level (`./.agento/`) configurations
- **Launch Modes**:
  - Child mode (default): Temporarily patches config, restores on exit
  - Independent mode: Persistent config changes
- **Backup System**: Automatic backups before any config modifications
- **Shell PATH Resolution**: Automatic PATH resolution through login shell
- **Multi-tier Profiles**: Support for `small`, `base`, and `smart` model tiers
- **Environment Variable Injection**: For agents requiring API keys via env vars (Codex)

### Technical

- TypeScript 5.5 + Node.js ≥18
- ES Modules
- Vitest for testing
- Zod for schema validation
- smol-toml for TOML config support
- Commander for CLI framework
- Ink + React for TUI

### Fixed

- Qwen CLI adapter now correctly uses `"openai"` as the modelProviders key for all OpenAI-compatible providers (previously used provider name)
