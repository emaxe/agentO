/**
 * App-level wiring for the first-run path and the last-launch memory.
 *
 * The individual screens are covered elsewhere; this test makes sure the
 * routing between them (and the async config read that feeds the menu) is
 * actually connected.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

let homeDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

async function poll(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`Never matched: ${what}\n${frame}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 100));

describe('App first-run and last-launch wiring', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-app-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('leads from the main menu to the provider screen when there is nothing configured', async () => {
    const { App } = await import('./App.js');
    const { stdin, lastFrame } = render(<App />);

    await poll(lastFrame, (f) => f.includes('Providers: 0'), 'menu counts loaded');
    await settle();
    stdin.write('1'); // Launch Agent
    await poll(lastFrame, (f) => f.includes('No profiles yet.'), 'launch empty state');
    await settle();
    stdin.write('p');
    await poll(lastFrame, (f) => f.includes('[+ Add provider]'), 'providers screen');
  });

  it('shows the last launch recorded in the UI cache', async () => {
    const { writeConfig } = await import('../config/store.js');
    const { writeLastLaunch } = await import('../config/ui-state.js');
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
    await writeLastLaunch({
      profileId: '00000000-0000-0000-0000-000000000002',
      agentId: 'claude-code',
      mode: 'independent',
      scope: 'global',
    });

    const { App } = await import('./App.js');
    const { lastFrame } = render(<App />);
    const frame = await poll(
      lastFrame,
      (f) => f.includes('Last: work → Claude Code (independent, global)'),
      'last launch line',
    );
    expect(frame).toContain('Profiles: 1');
  });

  it('opens the launch wizard directly when asked (post-agent relaunch)', async () => {
    const { App } = await import('./App.js');
    const { lastFrame } = render(<App initialScreen="launch" />);
    const frame = await poll(
      lastFrame,
      (f) => f.includes('No profiles yet.'),
      'launch screen opened',
    );
    expect(frame).not.toContain('Settings');
  });
});
