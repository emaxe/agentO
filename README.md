# AgentO — AI Agent Configuration Manager

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Manage AI agent configurations with profiles and providers. Switch between models, providers, and agents seamlessly.

AgentO is a CLI tool that centralizes configuration management for popular AI coding agents. Define your API providers once, create profiles with different model combinations, and switch between them with a single command.

**Русская версия:** [README.ru.md](README.ru.md)

## Supported Agents

| Agent | Command | Config Format | Supported Providers | Special Features |
|-------|---------|---------------|---|------------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | `anthropic`, `fireworks` | Multi-tier support (small/base/smart) |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | `anthropic`, `openai-compatible`, `fireworks` | Full function calling support via Vercel AI SDK |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | `openai-compatible`, `fireworks` | OpenAI-compatible API structure |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | All types | Environment variable injection. Hidden by default (`--dev` to show). |

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
| `anthropic` | claude-code | Anthropic |
| `openai-compatible` | opencode, qwen | OpenAI, Together.ai, Cerebras, Perplexity, DeepSeek, etc. |
| `fireworks` | claude-code, opencode, qwen, codex | Fireworks AI (supports all 3 API types) |

**Note:** `claude-code` only works with `anthropic` and `fireworks` types (Anthropic SDK requirement). Use `opencode` or `qwen` for other OpenAI-compatible providers.

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
┌────────── AgentO v0.1.1 ──────────┐
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
| **Launch Agent** | Select profile → select agent → choose mode/scope → launch | **Enter** select, **Esc** back |
| **Providers** | View, add, edit, delete API providers | **Enter** details, **a** add, **e** edit, **d** delete, **Esc** back |
| **Profiles** | View, add, delete profiles. In profile details: add/remove/edit models | **Enter** details, **a** add, **d** delete, **Esc** back |
| **Agents** | Check config status (global/project), backup availability | **Enter** details, **Esc** back |
| **Settings** | Change default launch mode, default config scope, independent mode | **↑↓** change, **Enter** toggle, **Esc** save & back |

### Launch Agent Workflow

1. **Select Profile** — Choose from your saved profiles
2. **Select Agent** — Pick which agent to launch (claude-code, opencode, qwen, or codex with `--dev`)
3. **Optional:** Adjust **Mode** (child/independent) and **Scope** (global/project)
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

- **View** all providers with their type, models count, and base URL
- **Add** a new provider with guided prompts (name, type, API key, models, base URL)
- **Edit** existing provider details
- **Delete** providers you no longer need

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
| **anthropic** | ✅ Full support | ✅ (via SDK) | ❌ Not supported | ✅ (via Responses API) |
| **openai-compatible** | ❌ Not supported | ✅ Full support | ✅ Full support | ✅ (via Responses API) |
| **fireworks** | ✅ (Anthropic API) | ✅ (OpenAI API) | ✅ (OpenAI API) | ✅ (Responses API) |

**Key Constraints:**
- `claude-code` uses **Anthropic SDK** and only works with `anthropic` or `fireworks` types
- Other OpenAI-compatible providers must use `opencode` or `qwen` agents
- `fireworks` type is the most flexible — works with all agents through native Fireworks APIs

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
  -t, --type <type>         Provider type: anthropic, openai-compatible, or fireworks (required)
  -k, --api-key <key>       API key (required)
  -u, --base-url <url>      Base URL (required for openai-compatible, optional for others)
  -M, --models <models>     Comma-separated list of model names (required)
agento provider remove <name>                 # Remove a provider
```

**Base URL Defaults:**
- `anthropic`: Uses Anthropic's default endpoint
- `fireworks`: Auto-defaults to `https://api.fireworks.ai/inference` if not specified
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
      "models": ["claude-opus-4-20250514", "claude-sonnet-4-20250514"]
    },
    {
      "id": "uuid",
      "name": "Fireworks",
      "type": "fireworks",
      "apiKey": "fw-...",
      "models": ["accounts/fireworks/models/llama-v3p1-70b-instruct"]
    },
    {
      "id": "uuid",
      "name": "Together",
      "type": "openai-compatible",
      "apiKey": "your-api-key",
      "baseUrl": "https://api.together.xyz/v1",
      "models": ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"]
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

## How It Works

### Agent Adapters

Each supported agent has a dedicated adapter that translates AgentO's generic config format into the agent's specific configuration:

- **Claude Code** (supports `anthropic`, `fireworks`): Generates `~/.claude/settings.json` with tier-based model selection and ANTHROPIC_* env vars. Uses Anthropic SDK.
  - ⚠️ **Does NOT support** `openai-compatible` providers (Anthropic SDK incompatibility)
  
- **OpenCode** (supports `anthropic`, `openai-compatible`, `fireworks`): Generates `~/.config/opencode/config.json` using Vercel AI SDK with provider-prefixed model names. Full function calling support via `@ai-sdk/openai-compatible`.
  
- **Qwen CLI** (supports `openai-compatible`, `fireworks`): Generates `~/.qwen/settings.json` with OpenAI-compatible provider structure. Requires `baseUrl` for all providers. Auto-defaults for `fireworks` type.
  
- **Codex CLI** (`--dev` to show): Generates `~/.codex/config.toml` with `wire_api: responses`, profiles, and environment variable references. In project scope, splits config between global (`model_providers`) and project (`model`) configs. Supports all provider types.

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
