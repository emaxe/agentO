/**
 * The agent list is sorted by install status, so a not-installed agent can move
 * to the bottom after the version check. The highlighted row and the agent that
 * preview/launch resolve must stay the same agent after that reorder.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { AgentInstaller } from '../../installers/base.js';

let homeDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

vi.mock('../../agents/registry.js', async () => {
  const { claudeCodeAdapter } = await import('../../adapters/claude-code.js');
  const installer = (installed: boolean): AgentInstaller =>
    ({
      agentId: 'fake',
      checkInstalled: async () => ({ installed }),
      checkEnvironment: async () => ({ ok: true }),
      install: async () => ({ success: true }),
      update: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      manualInstructions: { commands: [], docsUrl: '' },
    }) as unknown as AgentInstaller;

  return {
    listAgents: () => [
      {
        id: 'alpha',
        label: 'Alpha',
        command: 'alpha',
        adapter: claudeCodeAdapter,
        installer: installer(false),
      },
      {
        id: 'beta',
        label: 'Beta',
        command: 'beta',
        adapter: claudeCodeAdapter,
        installer: installer(true),
      },
    ],
    getAgentCommand: (id: string) =>
      id === 'alpha'
        ? { id: 'alpha', label: 'Alpha', adapter: claudeCodeAdapter, command: 'alpha' }
        : { id: 'beta', label: 'Beta', adapter: claudeCodeAdapter, command: 'beta' },
  };
});

async function poll(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  what: string,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`Never matched: ${what}\n${frame}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 80));

describe('Launch wizard agent sorting', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-launch-sort-'));
    const { writeConfig } = await import('../../config/store.js');
    const providerId = '00000000-0000-0000-0000-000000000001';
    await writeConfig({
      providers: [
        {
          id: providerId,
          name: 'Acme',
          type: 'openai-compatible',
          apiKey: 'sk-test',
          baseUrl: 'https://api.example.com/v1',
          models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }],
        },
      ],
      profiles: [
        {
          id: '00000000-0000-0000-0000-000000000002',
          name: 'work',
          models: [{ providerId, model: 'm1' }],
        },
      ],
      settings: {
        defaultLaunchMode: 'child',
        defaultConfigScope: 'project',
        mergeAgentConfigs: true,
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('previews the highlighted agent after install status reorders the list', async () => {
    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { stdin, lastFrame } = render(<LaunchAgent onBack={() => {}} />);

    await poll(lastFrame, (f) => f.includes('Profile: work'), 'profile step');
    await settle();
    stdin.write('\r');

    // After the checks, Beta (installed) is first and Alpha (not installed) is
    // last. The cursor must stay on Alpha, which is what the user sees.
    const agentStep = await poll(
      lastFrame,
      (f) => f.includes('v preview') && f.includes('▶ Alpha (not installed)'),
      'cursor keeps Alpha highlighted after sorting',
    );
    expect(agentStep.indexOf('▶ Alpha')).toBeGreaterThan(agentStep.indexOf('Beta'));

    await settle();
    stdin.write('v');
    const preview = await poll(
      lastFrame,
      (f) => f.includes('Launch Preview') && f.includes('Agent:'),
      'preview screen',
    );
    expect(preview).toContain('Agent:    Alpha');
    expect(preview).not.toContain('Agent:    Beta');
  }, 15_000);
});
