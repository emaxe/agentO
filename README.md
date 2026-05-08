# AgentO

Global CLI tool to manage AI agent configurations with profiles and providers.

## Install

```bash
npm install -g agento
```

## Usage

### TUI (interactive)
```bash
agento
```

### CLI commands

**Launch an agent:**
```bash
agento launch --profile myprofile --agent claude-code
agento launch --profile myprofile --agent opencode --mode independent --scope project
```

**Manage providers:**
```bash
agento provider list
agento provider add --name "My Anthropic" --type anthropic --api-key sk-ant-xxx --models claude-opus-4-5,claude-sonnet-4-5
agento provider remove "My Anthropic"
```

**Manage profiles:**
```bash
agento profile list
agento profile add --name myprofile --models <providerId>:claude-opus-4-5
agento profile remove myprofile
```

**Restore agent config:**
```bash
agento restore --agent claude-code --scope global
agento agent status
```

## Supported agents

| Agent | ID | Config path |
|-------|-----|-------------|
| Claude Code | `claude-code` | `~/.claude/settings.json` |
| OpenCode | `opencode` | `~/.config/opencode/config.json` |

## Launch modes

- **child** (default): AgentO waits for the agent to exit, then restores the original config
- **independent**: Agent runs detached, AgentO exits immediately; restore manually with `agento restore`

## Config

All settings stored in `~/.agento/config.json`. API keys are stored in plaintext.

## Status

Done
