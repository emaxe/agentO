/**
 * The launch wizard historically applied the Settings defaults invisibly:
 * the user could not see which mode/scope a launch would use and had to leave
 * the wizard to change them. The wizard now shows an effective-config footer
 * with `m`/`s` toggles on both steps.
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
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`Never matched: ${what}\n${frame}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 100));

/** Pretend every agent is installed so tests never spawn version checks. */
async function installedCache() {
  const { listAgents } = await import('../../agents/registry.js');
  return Object.fromEntries(
    listAgents({ dev: true }).map((agent) => [agent.id, { installed: true }]),
  );
}

describe('Launch wizard mode/scope footer', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-launch-footer-'));
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

  it('shows the effective mode and scope with the selected profile', async () => {
    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { lastFrame } = render(
      <LaunchAgent onBack={() => {}} agentStatusCache={await installedCache()} />,
    );
    const frame = await poll(
      lastFrame,
      (f) => f.includes('work') && f.includes('mode: child') && f.includes('scope: project'),
      'footer with defaults',
    );
    expect(frame).toContain('Profile: work');
  });

  it('toggles launch mode with m and scope with s', async () => {
    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { stdin, lastFrame } = render(
      <LaunchAgent onBack={() => {}} agentStatusCache={await installedCache()} />,
    );
    await poll(lastFrame, (f) => f.includes('mode: child'), 'footer visible');
    await settle();

    stdin.write('m');
    await poll(lastFrame, (f) => f.includes('mode: independent'), 'mode toggled');
    await settle();

    stdin.write('s');
    await poll(lastFrame, (f) => f.includes('scope: global'), 'scope toggled');
  });

  it('preselects the profile, mode and scope from the last launch', async () => {
    const { readConfig, writeConfig } = await import('../../config/store.js');
    const { writeLastLaunch } = await import('../../config/ui-state.js');
    const config = await readConfig();
    config.profiles.push({
      id: '00000000-0000-0000-0000-000000000003',
      name: 'personal',
      models: config.profiles[0]!.models,
    });
    await writeConfig(config);
    await writeLastLaunch({
      profileId: '00000000-0000-0000-0000-000000000003',
      agentId: 'claude-code',
      mode: 'independent',
      scope: 'global',
    });

    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { lastFrame } = render(<LaunchAgent onBack={() => {}} />);
    const frame = await poll(
      lastFrame,
      (f) =>
        f.includes('Profile: personal') &&
        f.includes('mode: independent') &&
        f.includes('scope: global'),
      'last launch preselected',
    );
    expect(frame).toContain('personal');
  });

  it('preselects the last launched agent when entering the agent step', async () => {
    const { readConfig } = await import('../../config/store.js');
    const { writeLastLaunch } = await import('../../config/ui-state.js');
    const config = await readConfig();
    await writeLastLaunch({
      profileId: config.profiles[0]!.id,
      agentId: 'codex',
      mode: 'child',
      scope: 'project',
    });

    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { stdin, lastFrame } = render(
      <LaunchAgent onBack={() => {}} agentStatusCache={await installedCache()} />,
    );
    await poll(lastFrame, (f) => f.includes('Profile: work'), 'profile step');
    await settle();
    stdin.write('\r');

    await poll(lastFrame, (f) => f.includes('▶ Codex CLI'), 'last agent highlighted');
  });

  it('opens a read-only launch preview with v and returns with Escape', async () => {
    const { LaunchAgent } = await import('./LaunchAgent.js');
    const { stdin, lastFrame } = render(
      <LaunchAgent onBack={() => {}} agentStatusCache={await installedCache()} />,
    );
    await poll(lastFrame, (f) => f.includes('Profile: work'), 'profile step');
    await settle();
    stdin.write('\r');
    await settle();
    await poll(lastFrame, (f) => f.includes('v preview'), 'agent step status check done');
    await settle();

    stdin.write('v');
    const preview = await poll(
      lastFrame,
      (f) => f.includes('Launch Preview') && f.includes('Profile:  work'),
      'preview screen',
    );
    expect(preview).toContain('Mode:     child');
    expect(preview).toContain('Files:');
    expect(preview).toContain('.claude');

    await settle();
    stdin.write('\u001B');
    await poll(lastFrame, (f) => f.includes('Select Agent'), 'back to agent step');
  }, 15_000);
});
