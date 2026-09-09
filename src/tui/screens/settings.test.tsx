/**
 * Tests for the Settings screen.
 *
 * Two things these guard: every setting that exists in the schema must be
 * reachable from the UI (mergeAgentConfigs had no toggle at all), and the
 * one-line explanations must describe the *agent's* config files — the old
 * text pointed at ~/.agento/config.json, which is Agento's own state and
 * has nothing to do with what the scope switch changes.
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

beforeEach(async () => {
  vi.resetModules();
  homeDir = await mkdtemp(join(tmpdir(), 'agento-settings-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(homeDir, { recursive: true, force: true });
});

async function pollFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`Frame never matched: ${what}\n${frame}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Frame line that carries the `▶` cursor. */
function cursorLine(frame: string): string {
  return frame.split('\n').find((l) => l.includes('▶')) ?? '';
}

/** The dim explanation line rendered right below the focused row, if any. */
function descriptionLine(frame: string): string {
  const lines = frame.split('\n');
  const idx = lines.findIndex((l) => l.includes('▶'));
  return idx === -1 ? '' : (lines[idx + 1] ?? '');
}

describe('Settings screen', () => {
  it('exposes the mergeAgentConfigs toggle', async () => {
    const { Settings } = await import('./Settings.js');
    const { lastFrame } = render(<Settings onBack={() => {}} />);
    await pollFrame(lastFrame, (f) => f.includes('Merge Agent Configs'), 'merge setting visible');
  });

  it('toggling Merge Agent Configs persists the new value', async () => {
    const { Settings } = await import('./Settings.js');
    const { readConfig } = await import('../../config/store.js');
    expect((await readConfig()).settings.mergeAgentConfigs).toBe(true);

    const { stdin, lastFrame } = render(<Settings onBack={() => {}} />);
    await pollFrame(lastFrame, (f) => f.includes('true'), 'initial values loaded');

    // The merge toggle is the last row; navigate down until the cursor is on it.
    for (let i = 0; i < 5; i++) {
      if (cursorLine(lastFrame() ?? '').includes('Merge Agent Configs')) break;
      stdin.write('\u001B[B');
      await new Promise((r) => setTimeout(r, 80));
    }
    await pollFrame(
      lastFrame,
      (f) => cursorLine(f).includes('Merge Agent Configs'),
      'merge row focused',
    );
    await new Promise((r) => setTimeout(r, 100));

    stdin.write('\r');
    await pollFrame(
      lastFrame,
      (f) => cursorLine(f).includes('Merge Agent Configs: false'),
      'merge shows false',
    );
    const deadline = Date.now() + 2000;
    for (;;) {
      const config = await readConfig();
      if (config.settings.mergeAgentConfigs === false) break;
      if (Date.now() > deadline) throw new Error('mergeAgentConfigs never persisted as false');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('describes the config scope with the agent config path, not Agento internals', async () => {
    const { Settings } = await import('./Settings.js');
    const { stdin, lastFrame } = render(<Settings onBack={() => {}} />);
    await pollFrame(lastFrame, (f) => f.includes('Default Launch Mode'), 'loaded');

    for (let i = 0; i < 5; i++) {
      if (cursorLine(lastFrame() ?? '').includes('Default Config Scope')) break;
      stdin.write('\u001B[B');
      await new Promise((r) => setTimeout(r, 80));
    }
    const frame = await pollFrame(
      lastFrame,
      (f) => cursorLine(f).includes('Default Config Scope'),
      'scope row focused',
    );
    const description = descriptionLine(frame);
    expect(description).toBeTruthy();
    expect(description).not.toContain('.agento/config.json');
    expect(description.toLowerCase()).toMatch(/agent|settings\.json|config\.toml|project/);
  });
});
