# AgentO — AI Agent Configuration Manager

[![npm version](https://img.shields.io/npm/v/%40emaxe%2Fagento)](https://www.npmjs.com/package/@emaxe/agento)
[![CI](https://github.com/emaxe/agentO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/emaxe/agentO/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/%40emaxe%2Fagento)](https://www.npmjs.com/package/@emaxe/agento)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue)](https://github.com/emaxe/agentO#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Set up once, launch again with one key. Share model profiles and API providers across nine AI coding agents.

AgentO is a CLI tool that centralizes configuration management for popular AI coding agents. Define your API providers once, create profiles with different model combinations, and switch between them with a single command.

**Русская версия:** [README.ru.md](README.ru.md)

## Supported Agents

| Agent | Command | Config Format | Supported Providers | Special Features |
|-------|---------|---------------|---|------------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible` | Multi-tier support (small/base/smart). Uses local proxy for non-Anthropic providers. |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Full function calling support via Vercel AI SDK |
| [Qwen CLI](https://github.com/QwenLM/qwen-code) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | OpenAI-compatible API structure |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `openai-compatible`, `responses-compatible`, `fireworks`, `openrouter`, `custom-api` | `wire_api: responses`. Profile stored in separate `default.config.toml`. |
| [Kimi Code](https://www.kimi.com/code) | `kimi` | TOML | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Writes `~/.kimi/config.toml` (`default_model`, `providers`, `models`); reads the legacy `~/.kimi/config.json` too. |
| [Kilo Code](https://github.com/Kilo-Org/kilo-code) | `kilo` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Reads `defaultProvider`/`defaultModel` from `~/.kilocode/settings.json`. Custom `baseUrl` from `~/.kilocode/models.json`. |
| [PI](https://pi.dev/docs/getting-started/installation) | `pi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Reads `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`. Custom `baseUrl` from `~/.pi/agent/models.json`. |
| [Copilot](https://github.com/github/copilot-cli) | `copilot` | env vars only | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Config delivered entirely via env vars — no settings file patched. |
| [Goose](https://goose-docs.ai) | `goose` | env vars only | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Config delivered entirely via env vars (`GOOSE_PROVIDER`, `GOOSE_MODEL`). |

## Installation

### Global Installation (Recommended)

```bash
npm install -g @emaxe/agento
```

### Local Installation

```bash
npm install --save-dev @emaxe/agento
npx @emaxe/agento
```

### Requirements

- **Operating systems:** macOS, Linux, Windows 10 (1809+) and Windows 11
- Node.js ≥ 18 (on Windows, Node 20+ and [Windows Terminal](https://aka.ms/terminal) are recommended)
- One or more supported AI agent CLI tools installed (AgentO can install most of them for you)

Supported workflows on all three systems include: the TUI, `agento launch` (child and independent
modes), `agento restore`, installed-agent detection and the install wizard. See
[Windows](#windows) for the platform-specific notes.

## Windows

```powershell
npm i -g @emaxe/agento
agento
```

Run it from PowerShell, Windows Terminal or `cmd.exe`. WSL also works and follows the Linux path.

- **Launching agents.** npm-installed CLIs are `.cmd` shims on Windows; AgentO resolves them via
  `PATH`/`PATHEXT` and starts them correctly, including from paths with spaces and non-ASCII characters.
- **Installing agents.** From the TUI install wizard, through npm, winget (Copilot) or uv (Kimi) where
  that is supported. **Goose is manual only** — run `winget search goose` or download it from
  <https://github.com/block/goose/releases/latest>.
- **Config locations.** Agents read their config from `%USERPROFILE%` (Goose: `%APPDATA%\Block\goose\config`).
  The full table is in [docs/windows-support/config-paths.md](docs/windows-support/config-paths.md).

### Windows limitations

- Only `.cmd`/`.bat`/`.exe` launchers are supported. A CLI that ships **only** a `.ps1` shim does not
  work under a restrictive PowerShell ExecutionPolicy (`Restricted`/`AllSigned`); AgentO does not bypass it.
- Windows has no graceful `SIGTERM`. Ctrl+C or closing the console window ends the agent's whole process
  tree (`taskkill /T /F`) and the original config is then restored.
- After a hard kill (Task Manager → End task, power loss) nothing can run, so the config is restored on
  the **next** `agento` launch: a stale backup whose process is gone is restored automatically.
- API keys are stored in plain text in the agents' own config files, as on macOS/Linux; there is no
  DPAPI/Credential Manager encryption.

### Windows troubleshooting

- **Agent installed, but AgentO says "not installed".** The terminal's `PATH` predates the install.
  Restart the terminal; AgentO also looks in `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`,
  `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin` and `%USERPROFILE%\.cargo\bin`.
- **`npm install -g` fails with `EPERM`/`EACCES`.** Point npm at a user-writable prefix:
  `npm config set prefix %APPDATA%\npm`.
- **`ENAMETOOLONG` / paths over 260 characters.** Enable long paths (`LongPathsEnabled=1` in
  `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`, then reboot) or use a shorter project path.
- **`Active backup already exists`.** A previous run did not finish cleanly. Run
  `agento restore -a <agent> -s <scope>` and launch again.

More detail — what was verified and what still needs manual acceptance — in
[docs/windows-support/report.md](docs/windows-support/report.md).

## Supported Provider Types

| Provider Type | Compatible Agents | Examples |
|---|---|---|
| `openai-compatible` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek, etc. |
| `anthropic-compatible` | claude-code, opencode, copilot, goose, pi, kilo, kimi | Anthropic, and any endpoint speaking the Anthropic Messages API |
| `fireworks` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | Fireworks AI (supports all 3 API types) |
| `openrouter` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | [OpenRouter](https://openrouter.ai) — universal LLM gateway (Anthropic Skin / OpenAI / Responses API) |
| `responses-compatible` | claude-code, opencode, codex, copilot, goose, kilo, kimi | OpenAI and any provider that speaks the OpenAI Responses API |
| `custom-api` | claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi | Any self-hosted or gateway endpoint; pick the wire protocols it speaks via `customApiModes` |

**Notes:**
- `claude-code` works with all 6 provider types. For non-`anthropic-compatible` providers, a local proxy handles protocol translation: Anthropic Scrubber for `fireworks`/`openrouter`; OpenAI-to-Anthropic proxy for `openai-compatible`; Responses Proxy for `responses-compatible`. For `openrouter` it uses OpenRouter's **Anthropic Skin** with `ANTHROPIC_AUTH_TOKEN` (Bearer auth).
- `copilot` and `goose` work with every provider type; config is delivered entirely via environment variables (no settings file is patched).
- `custom-api` is the escape hatch for a self-hosted endpoint or gateway: set `baseUrl` and enable the wire protocols it actually speaks via `customApiModes` (`openai`, `anthropic`, `responses`). At least one mode is required. AgentO appends the right suffix per mode — `/v1` for openai, nothing for anthropic (the client adds `/v1/messages` itself), `/v1/responses` for responses. `baseUrl` is stored exactly as entered; a trailing `/v1` (or a pasted full `/v1/responses` endpoint) is accepted and never doubled.
- `qwen` and `codex` are the only agents that cannot use `anthropic-compatible`; `qwen` and `pi` are the only ones that cannot use `responses-compatible`.

## API Keys & Git Safety

Provider API keys live in `~/.agento/config.json` (directory mode `0700`, file mode `0600`). AgentO uses environment variables where the adapter supports them; some adapters also write credentials into agent configuration files. Treat generated files and backup manifests as sensitive. Launch Preview shows the affected files and environment variable names without revealing values.

The one thing to know about **project scope**: in that mode AgentO selects the adapter's project configuration, which can include files *inside your repository* and global files (for example, Codex) (`.claude/settings.json`, `.codex/config.toml`, …), and several of those paths are conventionally committed — Claude Code, for instance, treats `.claude/settings.json` as the shared team file and only gitignores `settings.local.json`.

So on every project-scope launch AgentO appends the generated paths to `.git/info/exclude` and tells you it did:

```
Warning: Generated agent config may contain your API key; added to .git/info/exclude
so it is not committed: /.claude/settings.json
```

`.git/info/exclude` is local-only and never committed, so your project's own `.gitignore` is left untouched. Paths outside the repository are skipped, and repeated launches do not duplicate entries. If AgentO cannot write the file it says so rather than failing the launch — heed that warning before committing.

Prefer `global` scope (`-s global`, or Settings → Default config scope in the TUI) if you would rather agent configs never touch your repositories at all.

## Model Capability Flags

Every model in a provider carries three capability flags that describe which modalities it supports:

- **`image`** — model can process image inputs
- **`video`** — model can process video inputs
- **`audio`** — model can process audio inputs

Defaults when adding a model: `image=true`, `video=false`, `audio=false`.

**Marker format:** in the TUI and `agento provider list`, capabilities render as `[iva]` (all on), `[i--]` (image only), `[---]` (text only), etc. The marker is informational and is **never** written into the launched agent's config.

**Why it matters:**
- **Qwen** receives `generationConfig.modalities` derived from these flags (previously hardcoded to `false` — images didn't work).
- **OpenCode** emits per-model `modalities: { input: ["text", "image", ...], output: ["text"] }` so the agent knows what the model accepts.
- **Claude Code** and **Codex** ignore these flags today (Anthropic SDK and Codex `responses` API don't expose modality config).

**Toggling capabilities:** open the TUI → Providers → Edit, navigate to a model row, press `i` / `v` / `a` to toggle each flag. Add new models via the `[+ add model]` row (Enter). The CLI `provider add -M ...` creates models with default capabilities.

> Existing configs from older versions (with `string[]` models) are auto-migrated on first read with default capabilities.

## Quick Start

For guided setup, run `agento` and choose **Set up AgentO**. Connect a provider, choose or enter a model, save a profile, select an agent, review the changes, and launch. After that, **r** repeats the last confirmed launch.

The equivalent CLI workflow is below. See the [0.11.0 release notes](CHANGELOG.md#0110---2026-10-30) for the full list of changes.

### 1. Add API Providers

```bash
# Anthropic provider
agento provider add \
  -n "Anthropic" \
  -t anthropic-compatible \
  -k "sk-ant-your-key" \
  -M "claude-sonnet-4-20250514,claude-3-5-haiku-20241022"

# Fireworks AI provider (works with all agents)
agento provider add \
  -n "Fireworks" \
  -t fireworks \
  -k "fw-your-key" \
  -M "accounts/fireworks/models/llama-v3p1-70b-instruct,accounts/fireworks/models/kimi-k2p6"

# Other OpenAI-compatible providers (use with opencode or qwen)
agento provider add \
  -n "Together" \
  -t openai-compatible \
  -k "your-api-key" \
  -u "https://api.together.xyz/v1" \
  -M "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"

# OpenRouter (universal gateway — works with every supported agent)
agento provider add \
  -n "OpenRouter" \
  -t openrouter \
  -k "sk-or-v1-your-key" \
  -M "anthropic/claude-sonnet-4.6,openai/gpt-5,google/gemini-2.5-pro"
```

### 2. Create a Profile

```bash
# Single model profile
agento profile add -n "default" -m "my-provider:claude-sonnet-4-20250514"

# Multi-tier profile (requires tiers: small/base/smart)
# `my-provider` is a provider name or UUID; all models must belong to the same provider
agento profile add -n "multi" -m "my-provider:claude-3-5-haiku-20241022:small,my-provider:claude-sonnet-4-20250514:base,my-provider:claude-opus-4-20250514:smart"
```

### 3. Launch an Agent

```bash
# Interactive TUI mode (default)
agento

# Direct launch with Anthropic/Fireworks provider
agento launch -p default -a claude-code

# Launch with OpenAI-compatible provider (use opencode or qwen)
agento launch -p openai-profile -a opencode

# Launch with specific mode and scope
agento launch -p default -a qwen -m child -s project
```

## Interactive TUI

Running `agento` without arguments launches an interactive Terminal User Interface built with [Ink](https://github.com/vadimdemedes/ink) and React.

### Main Menu

The first action is **Launch last** (**r**) when a previous launch is available, or **Set up AgentO** for a first launch. Below it are **New launch**, **Profiles**, **Providers**, **Agents & recovery**, and **Settings**. The menu shows the current directory and the last profile, agent, primary model, mode and scope. **1–6** open sections directly; **↑↓ / Enter** select, **?** opens help, and **q / Esc** quits.

Active configuration backups have a separate notice. Press **b** to open recovery at an affected agent. After a child agent exits, the menu shows the agent result and configuration restoration result separately, including restoration failures.

### First Launch

Choose **Set up AgentO** to follow one route:

**Provider → Model → Profile → Agent → Review → Launch**

Select an existing provider or connect a known service/custom endpoint. **Load models** is optional: it retrieves the model catalog, without testing generation. If the endpoint is unavailable, retry or enter a model manually in **Models**. Connection data stays in the form after a request or save error. Save the provider explicitly, select a model, and accept or edit the suggested profile name. A single model does not require a tier.

Completed provider/profile saves remain available if you leave setup. A matching saved profile can be reused. Selecting an absent agent opens the installation wizard; compatibility checks use the same rules as CLI launch. The final review lists the model, provider, directory, actual files, environment variable names, and restoration behavior.

### New and Repeat Launches

**New launch** selects a profile and an agent. Profiles show their primary model and provider; **/** searches names, models and providers, including Unicode and pasted text. **m** changes child/independent mode and **s** changes global/project scope.

Installed agents appear first and keep their selection as status checks finish. **i** opens incompatibility reasons; **e** edits the selected profile and returns to the same launch. Installing an absent agent remains available here. Manage updates and uninstallations in **Agents & recovery**.

A new or changed launch opens **Launch Preview** automatically. **Enter** accepts it; **v** always opens it manually. A confirmed, unchanged launch runs directly, including **r** from the main menu. Changing the profile, model, credentials, endpoint, mode, scope, directory, merge setting, or affected config paths requires another review. The cache stores a versioned digest, never credentials or generated configuration. Missing or obsolete confirmation data requires review.

**Project scope can also change global files**, depending on the adapter. Review lists the actual files (including Codex's global files); env-only agents explicitly show that no files are written. **↑↓ / PgUp/PgDn** scroll long previews and help without hiding the main action.

If preparation fails, **r** retries, **a** opens recovery, and **t** reveals technical details. An existing backup for the selected scope offers **Restore previous config and launch**, with affected files and known session state shown first. Existing transaction locks and live-session protections still apply; shared-file conflicts identify the backup that must be restored.

In **child mode**, configuration is restored when the agent exits and AgentO returns to the main menu. In **independent mode**, AgentO exits and leaves configuration patched for later restoration.

### Forms and Keyboard

**Tab / Shift+Tab** move between fields. **Esc** cancels a model name edit, goes back a step, or asks before leaving an edited form. **Keep editing** is selected by default; choose **Discard changes** explicitly to leave. Forms show saving/saved/error states, prevent duplicate writes, and keep data available for retry after a failed save. API keys are masked by default; **Ctrl+R** explicitly reveals/hides the key in the provider form.

Lists resize with the terminal, preserve selection by identity, and bound expanded details. Capability markers use **[iva]** for image/video/audio; a dash means disabled. Multi-model roles are **small** for quick tasks, **base** for everyday work, and **smart** for complex tasks.

### Providers Screen

Manage your API providers without memorizing CLI flags:

- **View** all providers with their type, models, capability markers, and base URL
- **Add** a new provider with guided prompts (name, type, API key, models, base URL)
- **Edit** existing provider details — including per-model capability flags (`i`/`v`/`a` toggles). Models can be edited manually; **Load models** and **Choose loaded models** are optional helpers
- **Load models** from the list with `t`; the model count or error is shown under the selected row (no generation request is made)
- **Duplicate** a provider with `c` — useful for a second key or base URL; the copy gets the next free name
- **Filter** with `/` typed by provider name, type, base URL or model name
- **Delete** providers you no longer need. A provider still referenced by a profile cannot be deleted: the screen lists the profiles that block it

In edit view, models render as `▶ [i--] model-name`. Press `i` / `v` / `a` while a model row is highlighted to toggle image / video / audio capabilities. Use the `[+ add model]` row (Enter) to append models, `d` to delete, `e` to rename. API keys are masked in the list and form; **Ctrl+R** reveals/hides the key in the form.

### Profiles Screen

Organize your model configurations:

- **View** all profiles with their models and tiers
- **Add** profiles with single or multi-tier model configurations. Tiers already used by the profile are hidden; a multi-model profile must include one `base` tier. Adding a second model to a single untiered model asks for its tier first
- **Filter** the list with `/` typed by profile name, model or provider name
- **In profile details:** add/remove/edit individual model assignments

### Agents & Recovery Screen

Monitor the status of your agent configurations:

- See if each agent has a **global** or **project** config
- Check if **backups** exist (indicating AgentO has previously patched the config)
- View config file paths for each agent
- Press **/** to filter by agent name, scope or config path; **f** toggles “modified only”
- Press **i / u / d** to install / update / uninstall the selected agent.
- Press **r** to restore a modified config. AgentO asks for confirmation (`y/Enter: restore`, `n/Esc: cancel`) with affected files and known session state shown before restore replaces/removes the files and clears the backup

### Settings Screen

Configure defaults for AgentO behavior:

| Setting | Options | Description |
|---------|---------|-------------|
| **Default Launch Mode** | `child` / `independent` | How agents are launched by default |
| **Default Config Scope** | `global` / `project` | Where agent configs are written |
| **Merge Agent Configs** | `true` / `false` | Preserve unknown top-level keys when writing agent configs (conservative merge) |

**Controls:** **↑↓** navigate between settings, **Enter** or **Space** toggle values, **Esc** returns; each successful toggle is saved immediately.

### TUI vs CLI

| Task | TUI | CLI |
|------|-----|-----|
| Explore providers visually | ✅ | — |
| Quick one-off launch | — | `agento launch -p <p> -a <a>` |
| Script automation | — | ✅ |
| Check agent config status | ✅ | `agento agent status` |
| Guided provider/profile creation | ✅ | Manual flag composition |

Use **TUI** for exploration and interactive workflows. Use **CLI** for scripting, aliases, and quick launches.

## Provider & Agent Compatibility Matrix

| Provider Type | claude-code | opencode | qwen | codex | copilot | goose | pi | kilo | kimi |
|---|---|---|---|---|---|---|---|---|---|
| `openai-compatible` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `anthropic-compatible` | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `fireworks` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `openrouter` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `responses-compatible` | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `custom-api` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Key Constraints:**
- `claude-code` works with all 6 provider types; non-`anthropic-compatible` providers use a local proxy for protocol translation
- `qwen` and `codex` cannot use `anthropic-compatible`; `qwen` and `pi` cannot use `responses-compatible`
- `custom-api` works only when `customApiModes` enables at least one wire protocol (openai, anthropic or responses)
- For `openrouter` Claude Code uses `ANTHROPIC_AUTH_TOKEN` (Bearer) — not `apiKeyHelper`
- Provider API keys are never written into a generated config file; they are passed to the agent through the environment
- `copilot` and `goose` deliver all config via env vars — no settings file is ever patched or restored
- `fireworks` and `openrouter` are the most flexible — work with every supported agent

## CLI Reference

### `agento` — Main Command

Launches the interactive TUI by default.

```bash
agento          # Launch interactive TUI
agento --dev    # Deprecated: all agents are shown; kept for compatibility
```

On the first run choose **Set up AgentO** to connect a provider, select a model,
create a profile, and launch. Later, **r** repeats the last launch; changes to
launch settings require a new review.

### `agento launch` — Launch Agent

```bash
agento launch [-p <profile>] [-a <agent>] [options]

Options:
  -p, --profile <name>   Profile name or id (default: last launch)
  -a, --agent <id>       Agent id or label (default: last launch):
                         claude-code, opencode, qwen, codex, copilot, goose, pi, kilo, kimi
  -m, --mode <mode>      Launch mode: child or independent (default: last launch, then settings)
  -s, --scope <scope>    Config scope: global or project (default: last launch, then settings)
  -d, --dev              Deprecated: all agents are shown; kept for compatibility
  --dry-run              Print what would be patched without writing anything
```

If `-p`/`-a` are omitted, the last launch is used; if there is none, run
`agento` for the interactive picker. Profile and agent references are
case-insensitive, and a unique prefix is accepted (`-p wor -a clau`).
`--dry-run` lists files, env variable names, backup state and warnings, and
never writes.

**Launch Modes:**

- **Child** (default): Temporarily patches agent config, runs agent, restores original config on exit
- **Independent**: Patches config permanently; user must restore manually

**Config Scopes:**

- **Global**: `~/.<agent>/settings.*`
- **Project**: `./.<agent>/settings.*` or `./<agent>.*`

### `agento provider` — Manage Providers

```bash
agento provider list [--json]                 # List providers (keys masked)
agento provider add [options]                 # Add a new provider
  -n, --name <name>         Provider display name (required)
  -t, --type <type>         Provider type: openai-compatible, anthropic-compatible, fireworks, openrouter, responses-compatible, custom-api (required)
  -k, --api-key <key>       API key (required)
  -u, --base-url <url>      Base URL (required for responses-compatible/custom-api, optional for other types)
  -c, --custom-api-modes <json>  JSON flags {openai,anthropic,responses} (required for custom-api)
  -M, --models <models>     Comma-separated model names
  --fetch-models            Fetch models from the provider /models endpoint instead of -M
agento provider edit <name> [options]         # Edit name/type/key/baseUrl/models (same flags, all optional)
agento provider test <name> [--json]          # Test the /models endpoint
agento provider remove <name>                 # Remove a provider (refused while a profile uses it)
```

**Base URL Defaults:**
- `anthropic-compatible`: Uses Anthropic's default endpoint (`https://api.anthropic.com`)
- `fireworks`: Auto-defaults to `https://api.fireworks.ai/inference` if not specified
- `openrouter`: Auto-defaults to `https://openrouter.ai/api/v1` (Claude Code: `https://openrouter.ai/api`) if not specified
- `openai-compatible`: Auto-defaults to `https://api.openai.com/v1`; for non-standard providers specify explicitly with `-u`

### `agento profile` — Manage Profiles

```bash
agento profile list [--json]                   # List all profiles
agento profile add [options]                  # Add a new profile
  -n, --name <name>         Profile name (required)
  -m, --models <models>     Comma-separated list of provider:modelName[:tier] (required)
                            `provider` is a provider name (case-insensitive) or UUID.
                            Tier is optional for single-model profiles.
                            For multi-model: tier must be small|base|smart, at least one base.
agento profile remove <name>                  # Remove a profile
```

### `agento agent` — Agent Status

```bash
agento agent status [--json]                  # Status + installed version for all agents
agento agent status --dev                     # Deprecated: all agents are shown
```

### `agento restore` — Restore Config

```bash
agento restore [-a <agent>] [-s <scope>]       # Restore agent config from backup
agento restore --list                         # List active backups for the current directory

Options:
  -a, --agent <id>         Agent id or label (inferred when exactly one backup is active)
  -s, --scope <scope>      Config scope: global or project (inferred from active backups)
  -l, --list               List active backups without restoring
```

### `agento config` — Configuration Paths

```bash
agento config path [--json]                   # Print config, UI-state and backup paths
```

### `agento doctor` — Diagnostics

```bash
agento doctor [--json]                        # Versions, config health, active backups, installed agents
```

## Configuration

AgentO stores its configuration in `~/.agento/config.json`:

```json
{
  "providers": [
    {
      "id": "uuid",
      "name": "Anthropic",
      "type": "anthropic-compatible",
      "apiKey": "sk-ant-...",
      "models": [
        { "name": "claude-opus-4-20250514", "capabilities": { "image": true, "video": false, "audio": false } },
        { "name": "claude-sonnet-4-20250514", "capabilities": { "image": true, "video": false, "audio": false } }
      ]
    },
    {
      "id": "uuid",
      "name": "Fireworks",
      "type": "fireworks",
      "apiKey": "fw-...",
      "models": [
        { "name": "accounts/fireworks/models/llama-v3p1-70b-instruct", "capabilities": { "image": false, "video": false, "audio": false } }
      ]
    },
    {
      "id": "uuid",
      "name": "Together",
      "type": "openai-compatible",
      "apiKey": "your-api-key",
      "baseUrl": "https://api.together.xyz/v1",
      "models": [
        { "name": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "capabilities": { "image": false, "video": false, "audio": false } }
      ]
    }
  ],
  "profiles": [
    {
      "id": "uuid",
      "name": "default",
      "models": [
        {
          "providerId": "uuid",
          "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
          "tier": "base"
        }
      ]
    }
  ],
  "settings": {
    "defaultLaunchMode": "child",
    "defaultConfigScope": "global",
    "mergeAgentConfigs": true
  }
}
```

> Configs created with AgentO < 0.2.0 use bare `string[]` for `models`. They are migrated automatically on read; capabilities default to `{ image: true, video: false, audio: false }` and can be adjusted in the TUI.

### UI state

The last launched profile/agent/mode/scope is cached in `~/.agento/ui-state.json`.
A versioned confirmation digest also remembers the reviewed launch configuration,
including its directory. No credentials or generated configs are stored there.
It is optional: deleting it loses preselection and requires review on the next launch.
A malformed file or obsolete confirmation is ignored, never fatal. `agento config path` prints this path, the config path and
the backups directory.

## How It Works

### Agent Adapters

Each supported agent has a dedicated adapter that translates AgentO's generic config format into the agent's specific configuration:

- **Claude Code** (supports `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible`): Generates `~/.claude/settings.json` with tier-based model selection and ANTHROPIC_* env vars. Uses Anthropic SDK. The API key is **not** written into the file — `apiKeyHelper` reads it from `AGENTO_ANTHROPIC_API_KEY`, which AgentO injects into the agent's environment.
  - For `openrouter` and `fireworks`: automatically starts a local **Anthropic Scrubber proxy** that strips unsupported fields (e.g., `context_management`) from requests before forwarding to the upstream.
  - For `openai-compatible`: automatically starts a local **OpenAI-to-Anthropic proxy** (`src/proxy/openai-proxy.ts`) that translates OpenAI API requests/responses (including SSE streaming) to Anthropic format, then forwards to the upstream.
  - For `responses-compatible`: automatically starts a local **Responses Proxy** (`src/proxy/responses-proxy.ts`) that translates Anthropic requests to the OpenAI Responses API format with streaming support.
  - For `openrouter`: uses OpenRouter's **Anthropic Skin** — sets `ANTHROPIC_AUTH_TOKEN` (Bearer) + empty `ANTHROPIC_API_KEY`, no `apiKeyHelper`. Base URL: `https://openrouter.ai/api`.
  - Capability flags are not propagated (Anthropic SDK doesn't expose modality config)
  
- **OpenCode** (supports `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api`): Generates `~/.config/opencode/config.json` using Vercel AI SDK with provider-prefixed model names. Full function calling support via `@ai-sdk/openai-compatible`. Emits per-model `modalities: { input: [...], output: ["text"] }` derived from capability flags.
  
- **Qwen CLI** (supports `openai-compatible`, `fireworks`, `openrouter`, `custom-api`): Generates `~/.qwen/settings.json` with OpenAI-compatible provider structure. Requires `baseUrl` for all providers. Auto-defaults for `fireworks` type. Passes capability flags via `generationConfig.modalities`.
  
- **Codex CLI**: Generates `~/.codex/config.toml` with `wire_api: responses` and `model_providers`, plus a separate `~/.codex/default.config.toml` (flat `model` + `model_provider`) for the active profile. In project scope, splits config between global (`model_providers` + base `model`) and project (`model`) configs. Supports all provider types. Capability flags are not propagated (Codex `responses` API has no modality config).

- **Copilot** (supports every provider type): No settings file is written. All config is delivered at launch via `COPILOT_MODEL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_PROVIDER_BASE_URL`. Provider types `fireworks` and `openrouter` map to `COPILOT_PROVIDER_TYPE=openai`. Auto-enables `COPILOT_PROVIDER_WIRE_API=responses` for gpt-5 family models.

**Conservative Config Merge:** When `mergeAgentConfigs=true` (default), Claude Code, Qwen, and OpenCode adapters preserve unknown top-level keys from the existing config. Only keys generated by AgentO are overwritten. Nested objects are replaced whole, except `env` keys which are merged flat (existing env vars not managed by AgentO are kept). Copilot and Goose are unaffected (env-only, no config file mutation). Codex uses its own split-file merge logic and ignores this flag.

- **Goose** (supports every provider type): No settings file is written. All config is delivered via `GOOSE_PROVIDER` + `GOOSE_MODEL` + provider-specific keys. `anthropic-compatible` → `ANTHROPIC_API_KEY`; `openrouter` → `OPENROUTER_API_KEY`; `fireworks` / `openai-compatible` → `OPENAI_API_KEY` + `OPENAI_HOST`. Trailing `/v1` is stripped from `OPENAI_HOST` (Goose appends its own `/v1/chat/completions`).

### Backup & Restore

Before modifying any agent configuration, AgentO creates a v2 manifest backup at `~/.agento/backups/<agent>/<scope>.bak.json`.

If an active backup already exists for the same agent/scope, launch is blocked until you run `agento restore -a <agent> -s <scope>`. This prevents repeated Independent launches from overwriting the original backup. Launch is also blocked when another active backup reserves any of the same configuration files, including across scopes and project directories (for example, Codex project launches share global files). The error identifies the owning backup and project directory to restore. Preparation and restoration are serialized across AgentO processes; the backup reserves its files until restoration, including in Independent mode. After a crash, an abandoned operation lock expires after 10 seconds; the existing backup recovery rules still apply.

In **Child Mode**, the original config is automatically restored when the agent exits or receives SIGTERM/SIGINT.

In **Independent Mode**, the config remains modified. Restore manually with `agento restore`. If the agent config file did not exist before launch, restore removes the generated file instead of writing an empty config.

## Development

### Setup

```bash
git clone https://github.com/emaxe/agentO.git
cd agentO
npm install
```

### Scripts

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode compilation
npm test           # Run all tests
npm run test:watch # Watch mode tests
npm run typecheck  # TypeScript type checking
npm run lint       # ESLint
npm run format     # Prettier
```

### Architecture

```
src/
├── adapters/         # Agent-specific config translators
├── cli/commands/     # CLI command implementations
├── config/           # Config schema and storage
├── launcher/         # Agent launch logic
├── profiles/         # Profile management
├── providers/        # Provider management
└── tui/              # Terminal UI (Ink + React)
```

## Limitations & Known Issues

### Qwen CLI with Missing Base URL

**Problem:** Qwen requires `baseUrl` for all providers. Qwen does not accept `anthropic-compatible` at all, and any other type without a URL will error.

**Solution:** Always provide `-u` for Qwen with non-standard providers, or use `fireworks` type which auto-defaults.

## Troubleshooting

### Start here: `agento doctor`

```bash
agento doctor          # versions, config health, active backups, installed agents
agento config path     # where config.json, ui-state.json and backups live
```

### Changes in `src/` not applied

AgentO's global command uses compiled code from `dist/`, not `src/`. After any source changes:

```bash
npm run build
```

### Tests pass but global command behaves differently

The `dist/` folder is out of date. Rebuild:

```bash
npm run build
```

### Qwen CLI config shows "omni" instead of "openai"

This was a bug in versions < 0.1.1. Update to the latest version or rebuild.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

## License

[MIT](LICENSE) © AgentO Contributors
