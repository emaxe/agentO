import { claudeCodeAdapter } from '../adapters/claude-code.js';
import { openCodeAdapter } from '../adapters/opencode.js';
import { qwenAdapter } from '../adapters/qwen.js';
import { codexAdapter } from '../adapters/codex.js';
import { copilotAdapter } from '../adapters/copilot.js';
import { gooseAdapter } from '../adapters/goose.js';
import { piAdapter } from '../adapters/pi.js';
import { kiloAdapter } from '../adapters/kilo.js';
import { kimiAdapter } from '../adapters/kimi.js';
import { claudeCodeInstaller } from '../installers/claude-code.js';
import { openCodeInstaller } from '../installers/opencode.js';
import { qwenInstaller } from '../installers/qwen.js';
import { codexInstaller } from '../installers/codex.js';
import { copilotInstaller } from '../installers/copilot.js';
import { gooseInstaller } from '../installers/goose.js';
import { piInstaller } from '../installers/pi.js';
import { kiloInstaller } from '../installers/kilo.js';
import { kimiInstaller } from '../installers/kimi.js';
import type { AgentAdapter } from '../adapters/base.js';
import type { AgentId } from '../config/schema.js';
import type { AgentInstaller } from '../installers/base.js';

export interface AgentRegistryEntry {
  readonly id: AgentId;
  readonly label: string;
  readonly adapter: AgentAdapter;
  readonly command: string;
  readonly args?: string[];
  readonly installer?: AgentInstaller;
}

export interface AgentRegistryOptions {
  readonly dev?: boolean;
}

export interface AgentCommand {
  readonly adapter: AgentAdapter;
  readonly command: string;
  readonly args?: string[];
}

const AGENTS: readonly AgentRegistryEntry[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    adapter: claudeCodeAdapter,
    command: 'claude',
    installer: claudeCodeInstaller,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    adapter: openCodeAdapter,
    command: 'opencode',
    installer: openCodeInstaller,
  },
  {
    id: 'qwen',
    label: 'Qwen CLI',
    adapter: qwenAdapter,
    command: 'qwen',
    installer: qwenInstaller,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    adapter: codexAdapter,
    command: 'codex',
    args: ['-p', 'default'],
    installer: codexInstaller,
  },
  {
    id: 'copilot',
    label: 'Copilot CLI',
    adapter: copilotAdapter,
    command: 'copilot',
    installer: copilotInstaller,
  },
  {
    id: 'goose',
    label: 'Goose',
    adapter: gooseAdapter,
    command: 'goose',
    args: ['session'],
    installer: gooseInstaller,
  },
  {
    id: 'pi',
    label: 'PI',
    adapter: piAdapter,
    command: 'pi',
    installer: piInstaller,
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    adapter: kiloAdapter,
    command: 'kilo',
    installer: kiloInstaller,
  },
  {
    id: 'kimi',
    label: 'Kimi Code',
    adapter: kimiAdapter,
    command: 'kimi',
    installer: kimiInstaller,
  },
];

function isVisible(entry: AgentRegistryEntry, options: AgentRegistryOptions = {}): boolean {
  return Boolean(options.dev) || !entry.adapter.dev;
}

export function listAgents(options: AgentRegistryOptions = {}): readonly AgentRegistryEntry[] {
  return AGENTS.filter((entry) => isVisible(entry, options));
}

export function getAgent(
  id: string,
  options: AgentRegistryOptions = {},
): AgentRegistryEntry | undefined {
  return AGENTS.find((entry) => entry.id === id && isVisible(entry, options));
}

export function listAdapters(options: AgentRegistryOptions = {}): readonly AgentAdapter[] {
  return listAgents(options).map((entry) => entry.adapter);
}

export function getAgentCommand(
  id: string,
  options: AgentRegistryOptions = {},
): AgentCommand | undefined {
  const entry = getAgent(id, options);
  if (!entry) return undefined;
  return {
    adapter: entry.adapter,
    command: entry.command,
    args: entry.args,
  };
}

export function getAgentInstaller(
  id: string,
  options: AgentRegistryOptions = {},
): AgentInstaller | undefined {
  return getAgent(id, options)?.installer;
}
