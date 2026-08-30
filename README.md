# AgentO — AI Agent Configuration Manager

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Manage AI agent configurations with profiles and providers. Switch between models, providers, and agents seamlessly.

AgentO is a CLI tool that centralizes configuration management for popular AI coding agents. Define your API providers once, create profiles with different model combinations, and switch between them with a single command.

**Русская версия:** [README.ru.md](README.ru.md)

## Supported Agents

| Agent | Command | Config Format | Supported Providers | Special Features |
|-------|---------|---------------|---|------------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic-compatible`, `fireworks`, `openrouter`, `custom-api`, `openai-compatible`, `responses-compatible` | Multi-tier support (small/base/smart). Uses local proxy for non-Anthropic providers. |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Full function calling support via Vercel AI SDK |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | OpenAI-compatible API structure |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `openai-compatible`, `responses-compatible`, `fireworks`, `openrouter`, `custom-api` | `wire_api: responses`. Profile stored in separate `default.config.toml`. |
| [Kimi Code](https://www.kimi.com/code) | `kimi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Config delivered via `~/.kimi-cli/.env` (`DEFAULT_PROVIDER`, `DEFAULT_MODEL`, `BASE_URL`). |
| [Kilo Code](https://github.com/Kilo-Org/kilo-code) | `kilo` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Reads `defaultProvider`/`defaultModel` from `~/.kilocode/settings.json`. Custom `baseUrl` from `~/.kilocode/models.json`. |
| [PI](https://github.com/withpi/pi) | `pi` | JSON | `anthropic-compatible`, `openai-compatible`, `fireworks`, `openrouter`, `custom-api` | Reads `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`. Custom `baseUrl` from `~/.pi/agent/models.json`. |
| [Copilot](https://github.com/github/gh-copilot) | `copilot` | env vars only | `openai-compatible`, `anthropic-compatible`, `fireworks`, `openrouter`, `responses-compatible`, `custom-api` | Config delivered entirely via env vars — no settings file patched. |
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

- Node.js ≥ 18
- One or more supported AI agent CLI tools installed
- **macOS or Linux.** Windows is not supported today: launching an agent and
  installing one both go through `spawn(..., { shell: false })`, and npm-installed
  CLIs on Windows are `.cmd` shims that this cannot execute. The TUI opens and
  config management works, but agents will not start and every agent shows as "not
  installed". See [docs/windows-cross-platform-report.md](docs/windows-cross-platform-report.md)
  for the full breakdown and the roadmap.

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
- `custom-api` is the escape hatch for a self-hosted endpoint or gateway: set `baseUrl` and enable the wire protocols it actually speaks via `customApiModes` (`openai`, `anthropic`, `responses`). At least one mode is required. AgentO appends the right suffix per mode — `/v1` for openai, nothing for anthropic (the client adds `/v1/messages` itself), `/v1/responses` for responses.
- `qwen` and `codex` are the only agents that cannot use `anthropic-compatible`; `qwen` and `pi` are the only ones that cannot use `responses-compatible`.

## API Keys & Git Safety

Provider API keys live in `~/.agento/config.json` (directory mode `0700`, file mode `0600`) and are handed to the launched agent through its environment. They are **never** written into a generated agent config file.

The one thing to know about **project scope**: in that mode AgentO writes the agent's config *inside your repository* (`.claude/settings.json`, `.codex/config.toml`, …), and several of those paths are conventionally committed — Claude Code, for instance, treats `.claude/settings.json` as the shared team file and only gitignores `settings.local.json`.

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

# OpenRouter (universal gateway — works with all 4 agents)
agento provider add \
  -n "OpenRouter" \
  -t openrouter \
  -k "sk-or-v1-your-key" \
  -M "anthropic/claude-sonnet-4.6,openai/gpt-5,google/gemini-2.5-pro"
```

### 2. Create a Profile

```bash
# Single model profile
agento profile add -n "default" -m "provider-id:claude-sonnet-4-20250514"

# Multi-tier profile (requires tiers: small/base/smart)
# All models in a profile must belong to the same provider
agento profile add -n "multi" -m "provider-id:claude-3-5-haiku-20241022:small,provider-id:claude-sonnet-4-20250514:base,provider-id:claude-opus-4-20250514:smart"
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

```
┌────────── AgentO v0.8.0 ──────────┐
│                                   │
│ ▶  Launch Agent                   │
│    Providers                      │
│    Profiles                       │
│    Agents                         │
│    Settings                       │
│                                   │
└───────────────────────────────────┘
```

**Navigation:** **↑↓** to move, **Enter** to select, **Esc / q** to quit.

### Screens Overview

| Screen | What You Can Do | Key Shortcuts |
|--------|----------------|---------------|
| **Launch Agent** | Select profile → select agent (with install hints) → launch; opens Install Wizard for uninstalled agents; install statuses cached on disk. On installed agents: `u` to update, `d` to delete | **Enter** select, **Esc** back, **u** update, **d** delete |
| **Providers** | View, add, edit, delete API providers; toggle model capabilities | **Enter** details / add model, **a** add provider, **e** edit, **d** delete, **i/v/a** toggle capability, **Esc** back |
| **Profiles** | View, add, delete profiles. In profile details: add/remove/edit models | **Enter** details, **a** add, **d** delete, **Esc** back |
| **Agents** | Check config status (global/project), backup availability | **Enter** details, **Esc** back |
| **Settings** | Change default launch mode, default config scope; selected setting shows inline description of the current value | **↑↓** navigate, **Enter/Space** toggle, **Esc** save & back |

### Launch Agent Workflow

1. **Select Profile** — Choose from your saved profiles
2. **Select Agent** — AgentO checks install status of all agents (spinner while checking). Uninstalled agents show a `(not installed)` hint. Installed agents show `(u update, d delete)` when selected. Statuses are cached to `~/.agento/agent-status.json` so already-known-installed agents are skipped on the next launch.
   - If the selected agent **is installed** → press **Enter** to launch, **u** to update, or **d** to delete
   - If the selected agent **is not installed** → opens the **Install Wizard**
   - If the command is not found at launch time (ENOENT) → TUI relaunches with the error shown and the agent marked as not installed
3. **Install Wizard** (if needed):
   - **Auto-install** — checks environment (requires npm/brew/uv), then installs via the agent's native package manager
   - **Manual install** — shows the exact command and a docs URL
4. **Update / Delete Agent** (if triggered with `u`/`d` on an installed agent):
   - Confirmation prompt (`Да`/`Нет`)
   - Runs the appropriate command (`npm update -g`, `brew upgrade`, `uv tool uninstall`, etc.) with live spinner
   - On success → returns to agent list with updated install status
   - On error → shows stderr; options to retry or go back
5. **Launch** — AgentO patches the agent config and starts the agent

```
Profile: default
├─ Agent: claude-code
├─ Mode: child
├─ Scope: global
└─ [ Launch ]
```

In **child mode**, you'll be returned to AgentO when the agent exits, and the original config is automatically restored.

In **independent mode**, AgentO exits immediately and leaves the patched config in place.

### Providers Screen

Manage your API providers without memorizing CLI flags:

- **View** all providers with their type, models, capability markers, and base URL
- **Add** a new provider with guided prompts (name, type, API key, models, base URL)
- **Edit** existing provider details — including per-model capability flags (`i`/`v`/`a` toggles)
- **Delete** providers you no longer need

In edit view, models render as `▶ [i--] model-name`. Press `i` / `v` / `a` while a model row is highlighted to toggle image / video / audio capabilities. Use the `[+ add model]` row (Enter) to append models, `d` to delete, `e` to rename.

### Profiles Screen

Organize your model configurations:

- **View** all profiles with their models and tiers
- **Add** profiles with single or multi-tier model configurations
- **In profile details:** add/remove/edit individual model assignments

### Agents Screen

Monitor the status of your agent configurations:

- See if each agent has a **global** or **project** config
- Check if **backups** exist (indicating AgentO has previously patched the config)
- View config file paths for each agent

### Settings Screen

Configure defaults for AgentO behavior:

| Setting | Options | Description |
|---------|---------|-------------|
| **Default Launch Mode** | `child` / `independent` | How agents are launched by default |
| **Default Config Scope** | `global` / `project` | Where agent configs are written |
| **Merge Agent Configs** | `true` / `false` | Preserve unknown top-level keys when writing agent configs (conservative merge) |

**Controls:** **↑↓** navigate between settings, **Enter** or **Space** toggle values, **Esc** save and return.

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

| Provider Type | claude-code | opencode | qwen | codex | copilot | goose |
|---|---|---|---|---|---|---|
| **anthropic** | ✅ Full support | ✅ (via SDK) | ❌ Not supported | ❌ Not supported | ✅ (env vars) | ✅ (env vars) |
| **openai-compatible** | ✅ (via OpenAI proxy) | ✅ Full support | ✅ Full support | ✅ (Responses API) | ✅ (env vars) | ✅ (env vars) |
| **fireworks** | ✅ (via scrubber proxy) | ✅ (OpenAI API) | ✅ (OpenAI API) | ✅ (Responses API) | ✅ (env vars, OpenAI type) | ✅ (env vars, openai provider) |
| **openrouter** | ✅ (Anthropic Skin) | ✅ (OpenAI API) | ✅ (OpenAI API) | ✅ (Responses API) | ✅ (env vars, OpenAI type) | ✅ (env vars, openrouter provider) |
| **responses-compatible** | ✅ (via Responses Proxy) | ❌ | ❌ | ❌ | ❌ | ❌ |

**Key Constraints:**
- `claude-code` works with all 6 provider types; non-`anthropic-compatible` providers use a local proxy for protocol translation
- For `openrouter` Claude Code uses `ANTHROPIC_AUTH_TOKEN` (Bearer) — not `apiKeyHelper`
- Provider API keys are never written into a generated config file; they are passed to the agent through the environment
- `copilot` and `goose` deliver all config via env vars — no settings file is ever patched or restored
- `fireworks` and `openrouter` are the most flexible — work with all 6 agents

## CLI Reference

### `agento` — Main Command

Launches the interactive TUI by default.

```bash
agento          # Launch interactive TUI
agento --dev    # Show development agents (e.g. codex) in TUI
```

### `agento launch` — Launch Agent

```bash
agento launch -p <profile> -a <agent> [options]

Options:
  -p, --profile <name>   Profile name to use (required)
  -a, --agent <id>       Agent to launch: claude-code, opencode, qwen, codex (required)
  -m, --mode <mode>      Launch mode: child or independent (default: from settings)
  -s, --scope <scope>    Config scope: global or project (default: from settings)
  -d, --dev              Show development agents (e.g. codex)
```

**Launch Modes:**

- **Child** (default): Temporarily patches agent config, runs agent, restores original config on exit
- **Independent**: Patches config permanently; user must restore manually

**Config Scopes:**

- **Global**: `~/.<agent>/settings.*`
- **Project**: `./.<agent>/settings.*` or `./<agent>.*`

### `agento provider` — Manage Providers

```bash
agento provider list                          # List all providers
agento provider add [options]                 # Add a new provider
  -n, --name <name>         Provider display name (required)
  -t, --type <type>         Provider type: anthropic, openai-compatible, fireworks, or openrouter (required)
  -k, --api-key <key>       API key (required)
  -u, --base-url <url>      Base URL (required for openai-compatible, optional for others)
  -M, --models <models>     Comma-separated list of model names (required)
agento provider remove <name>                 # Remove a provider
```

**Base URL Defaults:**
- `anthropic-compatible`: Uses Anthropic's default endpoint (`https://api.anthropic.com`)
- `fireworks`: Auto-defaults to `https://api.fireworks.ai/inference` if not specified
- `openrouter`: Auto-defaults to `https://openrouter.ai/api/v1` (Claude Code: `https://openrouter.ai/api`) if not specified
- `openai-compatible`: Auto-defaults to `https://api.openai.com/v1`; for non-standard providers specify explicitly with `-u`

### `agento profile` — Manage Profiles

```bash
agento profile list                           # List all profiles
agento profile add [options]                  # Add a new profile
  -n, --name <name>         Profile name (required)
  -m, --models <models>     Comma-separated list of providerId:modelName[:tier] (required)
                            Tier is optional for single-model profiles.
                            For multi-model: tier must be small|base|smart, at least one base.
agento profile remove <name>                  # Remove a profile
```

### `agento agent` — Agent Status

```bash
agento agent status                           # Show config status for all agents
agento agent status --dev                     # Include development agents (e.g. codex)
```

### `agento restore` — Restore Config

```bash
agento restore -a <agent> -s <scope>          # Restore agent config from backup

Options:
  -a, --agent <id>         Agent ID (required)
  -s, --scope <scope>      Config scope: global or project (required)
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

If an active backup already exists for the same agent/scope, launch is blocked until you run `agento restore -a <agent> -s <scope>`. This prevents repeated Independent launches from overwriting the original backup.

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
