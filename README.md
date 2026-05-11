# AgentO — AI Agent Configuration Manager

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Manage AI agent configurations with profiles and providers. Switch between models, providers, and agents seamlessly.

AgentO is a CLI tool that centralizes configuration management for popular AI coding agents. Define your API providers once, create profiles with different model combinations, and switch between them with a single command.

**Русская версия:** [README.ru.md](README.ru.md)

## Supported Agents

| Agent | Command | Config Format | Supported Providers | Special Features |
|-------|---------|---------------|---|------------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic`, `fireworks`, `openrouter` | Multi-tier support (small/base/smart) |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic`, `openai-compatible`, `fireworks`, `openrouter` | Full function calling support via Vercel AI SDK |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | `openai-compatible`, `fireworks`, `openrouter` | OpenAI-compatible API structure |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | `fireworks`, `openrouter` | Environment variable injection. `wire_api: responses`. |

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

## Supported Provider Types

| Provider Type | Compatible Agents | Examples |
|---|---|---|
| `anthropic` | claude-code, opencode | Anthropic |
| `openai-compatible` | opencode, qwen | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek, etc. |
| `fireworks` | claude-code, opencode, qwen, codex | Fireworks AI (supports all 3 API types) |
| `openrouter` | claude-code, opencode, qwen, codex | [OpenRouter](https://openrouter.ai) — universal LLM gateway (Anthropic Skin / OpenAI / Responses API) |

**Notes:**
- `claude-code` works with `anthropic`, `fireworks`, and `openrouter` types. For `openrouter` it uses OpenRouter's **Anthropic Skin** with `ANTHROPIC_AUTH_TOKEN` (Bearer auth).
- Use `opencode` or `qwen` for general OpenAI-compatible providers.
- `openrouter` is the most flexible — works with all 4 agents.

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
  -t anthropic \
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
┌────────── AgentO v0.4.0 ──────────┐
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
| **Launch Agent** | Select profile → select agent (with install hints) → launch; opens Install Wizard for uninstalled agents | **Enter** select, **Esc** back |
| **Providers** | View, add, edit, delete API providers; toggle model capabilities | **Enter** details / add model, **a** add provider, **e** edit, **d** delete, **i/v/a** toggle capability, **Esc** back |
| **Profiles** | View, add, delete profiles. In profile details: add/remove/edit models | **Enter** details, **a** add, **d** delete, **Esc** back |
| **Agents** | Check config status (global/project), backup availability | **Enter** details, **Esc** back |
| **Settings** | Change default launch mode, default config scope, independent mode | **↑↓** change, **Enter** toggle, **Esc** save & back |

### Launch Agent Workflow

1. **Select Profile** — Choose from your saved profiles
2. **Select Agent** — AgentO checks install status of all agents (spinner while checking). Uninstalled agents show a `(not installed)` hint.
   - If the selected agent **is installed** → proceeds to launch
   - If the selected agent **is not installed** → opens the **Install Wizard**
3. **Install Wizard** (if needed):
   - **Auto-install** — checks environment (requires npm), then installs via `npm install -g <package>`
   - **Manual install** — shows the exact command and a docs URL
4. **Launch** — AgentO patches the agent config and starts the agent

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
| **Independent Mode** | `spawn-detached` / `pty` | How independent mode spawns agents |

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

| Provider Type | claude-code | opencode | qwen | codex |
|---|---|---|---|---|
| **anthropic** | ✅ Full support | ✅ (via SDK) | ❌ Not supported | ❌ Not supported |
| **openai-compatible** | ❌ Not supported | ✅ Full support | ✅ Full support | ❌ Not supported |
| **fireworks** | ✅ (Anthropic API) | ✅ (OpenAI API) | ✅ (OpenAI API) | ✅ (Responses API) |
| **openrouter** | ✅ (Anthropic Skin) | ✅ (OpenAI API) | ✅ (OpenAI API) | ✅ (Responses API) |

**Key Constraints:**
- `claude-code` uses Anthropic-compatible APIs and works with `anthropic`, `fireworks`, `openrouter` types
- For `openrouter` Claude Code uses `ANTHROPIC_AUTH_TOKEN` (Bearer) — not `apiKeyHelper`
- Other OpenAI-compatible providers must use `opencode` or `qwen` agents
- `fireworks` and `openrouter` are the most flexible — work with all 4 agents

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
- `anthropic`: Uses Anthropic's default endpoint
- `fireworks`: Auto-defaults to `https://api.fireworks.ai/inference` if not specified
- `openrouter`: Auto-defaults to `https://openrouter.ai/api/v1` (Claude Code: `https://openrouter.ai/api`) if not specified
- `openai-compatible`: Must be explicitly provided with `-u`

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
      "type": "anthropic",
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
    "independentMode": "pty"
  }
}
```

> Configs created with AgentO < 0.2.0 use bare `string[]` for `models`. They are migrated automatically on read; capabilities default to `{ image: true, video: false, audio: false }` and can be adjusted in the TUI.

## How It Works

### Agent Adapters

Each supported agent has a dedicated adapter that translates AgentO's generic config format into the agent's specific configuration:

- **Claude Code** (supports `anthropic`, `fireworks`, `openrouter`): Generates `~/.claude/settings.json` with tier-based model selection and ANTHROPIC_* env vars. Uses Anthropic SDK.
  - For `openrouter`: uses OpenRouter's **Anthropic Skin** — sets `ANTHROPIC_AUTH_TOKEN` (Bearer) + empty `ANTHROPIC_API_KEY`, no `apiKeyHelper`. Base URL: `https://openrouter.ai/api`
  - ⚠️ **Does NOT support** `openai-compatible` providers (Anthropic SDK incompatibility)
  - Capability flags are not propagated (Anthropic SDK doesn't expose modality config)
  
- **OpenCode** (supports `anthropic`, `openai-compatible`, `fireworks`): Generates `~/.config/opencode/config.json` using Vercel AI SDK with provider-prefixed model names. Full function calling support via `@ai-sdk/openai-compatible`. Emits per-model `modalities: { input: [...], output: ["text"] }` derived from capability flags.
  
- **Qwen CLI** (supports `openai-compatible`, `fireworks`): Generates `~/.qwen/settings.json` with OpenAI-compatible provider structure. Requires `baseUrl` for all providers. Auto-defaults for `fireworks` type. Passes capability flags via `generationConfig.modalities`.
  
- **Codex CLI** (`--dev` to show): Generates `~/.codex/config.toml` with `wire_api: responses`, profiles, and environment variable references. In project scope, splits config between global (`model_providers`) and project (`model`) configs. Supports all provider types. Capability flags are not propagated (Codex `responses` API has no modality config).

### Backup & Restore

Before modifying any agent configuration, AgentO creates a backup at `~/.agento/backups/<agent>/<scope>.bak.*`.

In **Child Mode**, the original config is automatically restored when the agent exits or receives SIGTERM/SIGINT.

In **Independent Mode**, the config remains modified. Restore manually with `agento restore`.

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

### Claude Code with OpenAI-Compatible Providers

**Problem:** Claude Code only works with Anthropic API due to hard dependency on Anthropic SDK.

**Solution:** Use `opencode` or `qwen` agents instead:
```bash
# ❌ This won't work:
agento launch -p myprofile -a claude-code  # (if profile uses openai-compatible provider)

# ✅ Use OpenCode instead:
agento launch -p myprofile -a opencode
```

### Qwen CLI with Missing Base URL

**Problem:** Qwen requires `baseUrl` for all providers. Using `anthropic` type without URL will error.

**Solution:** Always provide `-u` for Qwen with non-standard providers, or use `fireworks` type which auto-defaults.

### Codex CLI Hidden by Default

**Problem:** Codex is a development agent and hidden in TUI/CLI by default.

**Solution:** Add `--dev` flag to show it:
```bash
agento --dev                # TUI with Codex
agento launch -a codex --dev  # CLI with Codex
```

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
