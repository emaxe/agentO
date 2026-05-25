import { describe, expect, it } from 'vitest';
import { getAgent, getAgentCommand, listAgents } from './registry.js';

describe('agent registry', () => {
  it('listAgents() includes codex (stable agent)', () => {
    const ids = listAgents().map((agent) => agent.id);

    expect(ids).toContain('codex');
  });

  it('listAgents() returns all stable agents in registry order', () => {
    const ids = listAgents().map((agent) => agent.id);

    expect(ids).toEqual(['claude-code', 'opencode', 'qwen', 'codex', 'copilot', 'goose', 'pi']);
  });

  it('getAgentCommand("codex") returns command and default args', () => {
    const command = getAgentCommand('codex');

    expect(command?.command).toBe('codex');
    expect(command?.args).toEqual(['-p', 'default']);
  });

  it('getAgent("codex") returns codex agent', () => {
    expect(getAgent('codex')).toBeDefined();
    expect(getAgent('codex')?.id).toBe('codex');
  });

  it('getAgent("pi") returns pi agent', () => {
    expect(getAgent('pi')).toBeDefined();
    expect(getAgent('pi')?.id).toBe('pi');
    expect(getAgent('pi')?.command).toBe('pi');
    expect(getAgent('pi')?.args).toBeUndefined();
  });
});
