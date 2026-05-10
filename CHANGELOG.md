# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Additional agent support (continue.dev, aider, etc.)
- Profile import/export
- CLI flags for setting non-default capabilities at `provider add` time
- Plugin system for custom adapters
- Better error handling and logging
- Configuration templates and presets

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
