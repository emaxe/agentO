import React from 'react';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';

let homeDir = '';
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => homeDir,
}));
vi.mock('../../launcher/child.js', () => ({
  prepareChild: vi.fn(async () => ({
    execReq: { command: 'fake-agent', args: [], env: {} },
    cleanup: vi.fn(),
  })),
}));

const delay = () => new Promise((resolve) => setTimeout(resolve, 50));
async function poll(frame: () => string | undefined, text: string) {
  for (let n = 0; n < 80; n++) {
    if (frame()?.includes(text)) return frame()!;
    await delay();
  }
  throw new Error(`Missing ${text}:\n${frame()}`);
}
async function key(stdin: { write: (value: string) => void }, value: string) {
  // Ink can paint the next step before its passive input subscription refreshes.
  await delay();
  stdin.write(value);
  await delay();
}

beforeEach(async () => {
  vi.resetModules();
  homeDir = await mkdtemp(join(tmpdir(), 'agento-setup-'));
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await rm(homeDir, { recursive: true, force: true });
});

describe('guided setup and repeat', () => {
  it('recovers from an unavailable model catalog and launches through one flow, then repeats without a review', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('catalog unavailable')));
    const { listAgents } = await import('../../agents/registry.js');
    const cache = Object.fromEntries(listAgents().map((a) => [a.id, { installed: true }]));
    const { SetupWizard } = await import('./SetupWizard.js');
    const onExec = vi.fn();
    const ui = render(<SetupWizard onBack={vi.fn()} onExec={onExec} agentStatusCache={cache} />);
    await poll(ui.lastFrame, 'Provider service');
    await key(ui.stdin, '\r'); // OpenAI service
    await poll(ui.lastFrame, 'Add Provider');
    await key(ui.stdin, '\t');
    await key(ui.stdin, '\t');
    await key(ui.stdin, 'sk-test-secret');
    expect(ui.lastFrame()).not.toContain('sk-test-secret');
    await key(ui.stdin, '\t');
    await key(ui.stdin, 'https://api.example.test/v1');
    await key(ui.stdin, '\t');
    await key(ui.stdin, '\t'); // Load models
    await key(ui.stdin, '\r');
    await poll(ui.lastFrame, 'catalog unavailable');
    expect(ui.lastFrame()).toContain('enter a model');
    await key(ui.stdin, '\u001B[A'); // Models
    await key(ui.stdin, '\r');
    await poll(ui.lastFrame, 'Edit Models');
    await key(ui.stdin, '\r');
    await key(ui.stdin, 'manual-model');
    await key(ui.stdin, '\r');
    await key(ui.stdin, '\u001B');
    await key(ui.stdin, '\t');
    await key(ui.stdin, '\t'); // Save provider
    await key(ui.stdin, '\r');
    await poll(ui.lastFrame, '2/6 · Model');
    await key(ui.stdin, '\r');
    await poll(ui.lastFrame, '3/6 · Profile');
    expect(ui.lastFrame()).toContain('manual-model');
    await key(ui.stdin, '\r'); // Save profile
    await poll(ui.lastFrame, 'v preview');
    await key(ui.stdin, '\r');
    await poll(ui.lastFrame, 'Launch Preview');
    await poll(ui.lastFrame, 'Model:    manual-model (OpenAI)');
    expect(onExec).not.toHaveBeenCalled();
    await key(ui.stdin, '\r');
    for (let n = 0; !onExec.mock.calls.length && n < 80; n++) await delay();
    expect(onExec).toHaveBeenCalledTimes(1);
    const { readConfig } = await import('../../config/store.js');
    const config = await readConfig();
    expect(config.providers).toHaveLength(1);
    expect(config.profiles[0]?.models).toEqual([
      { providerId: config.providers[0]!.id, model: 'manual-model' },
    ]);
    const cacheText = await readFile(join(homeDir, '.agento', 'ui-state.json'), 'utf8');
    expect(cacheText).not.toContain('sk-test-secret');
    expect(JSON.parse(cacheText).confirmedLaunch.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    ui.unmount();

    const { LaunchAgent } = await import('../screens/LaunchAgent.js');
    const onRepeat = vi.fn();
    const repeated = render(
      <LaunchAgent repeatLast onBack={vi.fn()} onExec={onRepeat} agentStatusCache={cache} />,
    );
    for (let n = 0; !onRepeat.mock.calls.length && n < 80; n++) await delay();
    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(repeated.frames.some((f) => f.includes('Launch Preview'))).toBe(false);
    repeated.unmount();
    const { writeConfig } = await import('../../config/store.js');
    config.providers[0]!.apiKey = 'sk-replaced';
    await writeConfig(config);
    const changedExec = vi.fn();
    const changed = render(
      <LaunchAgent repeatLast onBack={vi.fn()} onExec={changedExec} agentStatusCache={cache} />,
    );
    await poll(changed.lastFrame, 'Launch Preview');
    await poll(changed.lastFrame, 'Model:    manual-model');
    expect(changedExec).not.toHaveBeenCalled();
    changed.unmount();
  }, 15000);
});
