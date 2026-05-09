# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Added

- **`--dev` flag** across CLI and TUI: show development agents (Codex CLI) hidden by default
- **Codex CLI adapter improvements**:
  - `wire_api` changed from `'openai'` to `'responses'`
  - Generates `default_profile` and `profiles.default` blocks in TOML config
  - `writeConfig` now handles `project` scope correctly: writes `model_providers` to global config and `model` to project config, with backup/restore of global config
  - Added `buildEnv` support for API key injection via environment variables
- **TUI Profiles screen**: redesigned detail view — `a` to add model, `d` to delete model, `↑↓` for navigation (removed implicit reorder)
- **TUI Providers screen**: `Enter` on the trailing row now opens add form (in addition to `a`)
- **Base adapter interface**: added optional `dev?: boolean` flag for marking development agents

### Changed

- Codex CLI is now marked as `dev: true` — hidden from TUI and CLI unless `--dev` is passed
- Launch command now passes `args` (e.g. `['-p', 'default']` for Codex) to child/independent launchers

### Planned

- Additional agent support (continue.dev, aider, etc.)
- Profile import/export
- Configuration validation and migration
- Plugin system for custom adapters
- Better error handling and logging
- Configuration templates and presets

