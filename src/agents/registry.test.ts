import { describe, expect, it } from 'vitest';
import { getAgent, getAgentCommand, listAgents } from './registry.js';

describe('agent registry', () => {
  it('listAgents() hides dev agents', () => {
    const ids = listAgents().map((agent) => agent.id);

    expect(ids).not.toContain('codex');
  });

  it('listAgents({ dev: true }) returns all agents in registry order', () => {
    const ids = listAgents({ dev: true }).map((agent) => agent.id);

    expect(ids).toEqual(['claude-code', 'opencode', 'qwen', 'codex', 'copilot', 'goose']);
  });

  it('getAgentCommand("codex", { dev: true }) returns command and default args', () => {
    const command = getAgentCommand('codex', { dev: true });

    expect(command?.command).toBe('codex');
    expect(command?.args).toEqual(['-p', 'default']);
  });

  it('getAgent("codex") does not return hidden dev agent without dev option', () => {
    expect(getAgent('codex')).toBeUndefined();
  });
});
