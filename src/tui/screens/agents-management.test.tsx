import React, { useEffect } from 'react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import type { AgentInstallStatus } from '../../config/store.js';
let homeDir = '';
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => homeDir,
}));
vi.mock('./AgentAction.js', () => ({
  AgentAction: ({ onDone }: { onDone: (result: { success: boolean }) => void }) => {
    useEffect(() => {
      onDone({ success: true });
    }, []);
    return null;
  },
}));
beforeEach(async () => {
  vi.resetModules();
  homeDir = await mkdtemp(join(tmpdir(), 'agento-management-'));
});
afterEach(async () => {
  cleanup();
  await rm(homeDir, { recursive: true, force: true });
});
const delay = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('agent management status', () => {
  it.each([
    ['d', false],
    ['u', true],
  ] as const)('refreshes launch caches after %s', async (key, installed) => {
    const { Agents } = await import('./Agents.js');
    const { readAgentStatusCache, writeAgentStatusCache } = await import('../../config/store.js');
    await writeAgentStatusCache({ 'claude-code': { installed: true, version: 'old' } });
    const cache: Record<string, AgentInstallStatus> = {
      'claude-code': { installed: true, version: 'old' },
    };
    const onAgentStatusChange = vi.fn();
    const ui = render(
      <Agents
        agentStatusCache={cache}
        onAgentStatusChange={onAgentStatusChange}
        onBack={() => {}}
      />,
    );
    for (let n = 0; !ui.lastFrame()?.includes('▶ Claude Code [global]') && n < 80; n++)
      await delay();
    expect(ui.lastFrame()).toContain('▶ Claude Code [global]');
    // Ink paints the row before its passive input subscription is refreshed.
    await new Promise((resolve) => setTimeout(resolve, 100));
    ui.stdin.write(key);
    for (
      let n = 0;
      !ui.lastFrame()?.includes(`claude-code: ${installed ? 'installed' : 'uninstalled'}`) &&
      n < 80;
      n++
    )
      await delay();
    expect(cache['claude-code']).toEqual({ installed });
    expect(onAgentStatusChange).toHaveBeenCalledWith('claude-code', { installed });
    expect((await readAgentStatusCache())['claude-code']).toEqual({ installed });
  });
});
