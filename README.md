# AgentO — AI Agent Configuration Manager

[![npm version](https://badge.fury.io/js/@emaxe%2fagento.svg)](https://www.npmjs.com/package/@emaxe/agento)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Manage AI agent configurations with profiles and providers. Switch between models, providers, and agents seamlessly.

AgentO is a CLI tool that centralizes configuration management for popular AI coding agents. Define your API providers once, create profiles with different model combinations, and switch between them with a single command.

## Supported Agents

| Agent | Command | Config Format | Special Features |
|-------|---------|---------------|------------------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` | JSON | Multi-tier support (small/base/smart) |
| [OpenCode](https://github.com/opencode-ai/opencode) | `opencode` | JSON | Custom provider prefix |
| [Qwen CLI](https://github.com/QwenLM/qwen) | `qwen` | JSON | OpenAI-compatible providers |
| [Codex CLI](https://github.com/openai/codex) | `codex` | TOML | Environment variable injection. Hidden by default (`--dev` to show). |

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

## Quick Start

### 1. Add an API Provider

```bash
# OpenAI-compatible provider (e.g., Fireworks AI)
agento provider add \
  -n "Fireworks AI" \
  -t openai-compatible \
  -k "sk-your-api-key" \
  -u "https://api.fireworks.ai/inference/v1" \
  -M "accounts/fireworks/models/llama-v3p1-70b-instruct,accounts/fireworks/models/kimi-k2p6"

# Anthropic provider
agento provider add \
  -n "Anthropic" \
  -t anthropic \
  -k "sk-ant-your-key" \
  -M "claude-sonnet-4-20250514,claude-3-5-haiku-20241022"
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

# Direct launch
agento launch -p default -a claude-code

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
  -t, --type <type>         Provider type: openai-compatible or anthropic (required)
  -k, --api-key <key>       API key (required)
  -u, --base-url <url>      Base URL (for openai-compatible)
  -M, --models <models>     Comma-separated list of model names (required)
agento provider remove <name>                 # Remove a provider
```

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
      "name": "Fireworks AI",
      "type": "openai-compatible",
      "apiKey": "sk-...",
      "baseUrl": "https://api.fireworks.ai/inference/v1",
      "models": ["accounts/fireworks/models/llama-v3p1-70b-instruct"]
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

- **Claude Code**: Generates `~/.claude/settings.json` with tier-based model selection
- **OpenCode**: Generates `~/.config/opencode/config.json` with provider-prefixed model names
- **Qwen CLI**: Generates `~/.qwen/settings.json` with OpenAI-compatible provider structure
- **Codex CLI** (`--dev` to show): Generates `~/.codex/config.toml` with `wire_api: responses`, profiles, and environment variable references. In project scope, splits config between global (`model_providers`) and project (`model`) configs.

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
