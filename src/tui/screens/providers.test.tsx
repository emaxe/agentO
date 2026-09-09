/**
 * Delete-confirmation flow on the Providers screen.
 *
 * The old screen confirmed on 'y' and cancelled on literally every other key,
 * so a mis-typed or Shift-pressed 'Y' silently discarded the intent and the
 * user thought the provider was still selected. Confirm is now y/Enter,
 * cancel is n/Esc, and unrelated keys are ignored.
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

async function setupProvider(name = 'Acme') {
  const { addProvider } = await import('../../providers/provider-manager.js');
  await addProvider({
    name,
    type: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }],
  });
}

async function providerNames(): Promise<string[]> {
  const { listProviders } = await import('../../providers/provider-manager.js');
  return (await listProviders()).map((p) => p.name);
}

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

async function openConfirm() {
  const { Providers } = await import('./Providers.js');
  const utils = render(<Providers onBack={() => {}} />);
  await poll(utils.lastFrame, (f) => f.includes('Acme'), 'provider list loaded');
  await settle();
  utils.stdin.write('d');
  await poll(utils.lastFrame, (f) => f.includes('Delete provider'), 'confirm shown');
  await settle();
  return utils;
}

describe('Providers delete confirmation', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-providers-del-'));
    await setupProvider();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('deletes on lowercase y', async () => {
    const { stdin } = await openConfirm();
    stdin.write('y');
    const deadline = Date.now() + 2000;
    for (;;) {
      if (!(await providerNames()).includes('Acme')) break;
      if (Date.now() > deadline) throw new Error('provider was not deleted on y');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('deletes on Enter', async () => {
    const { stdin } = await openConfirm();
    stdin.write('\r');
    const deadline = Date.now() + 2000;
    for (;;) {
      if (!(await providerNames()).includes('Acme')) break;
      if (Date.now() > deadline) throw new Error('provider was not deleted on Enter');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('deletes on uppercase Y', async () => {
    const { stdin } = await openConfirm();
    stdin.write('Y');
    const deadline = Date.now() + 2000;
    for (;;) {
      if (!(await providerNames()).includes('Acme')) break;
      if (Date.now() > deadline) throw new Error('provider was not deleted on Y');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('cancels on n', async () => {
    const { stdin, lastFrame } = await openConfirm();
    stdin.write('n');
    await poll(
      lastFrame,
      (f) => f.includes('Acme') && !f.includes('Delete provider'),
      'back to list',
    );
    expect(await providerNames()).toContain('Acme');
  });

  it('cancels on Escape', async () => {
    const { stdin, lastFrame } = await openConfirm();
    stdin.write('\u001B');
    await poll(
      lastFrame,
      (f) => f.includes('Acme') && !f.includes('Delete provider'),
      'back to list',
    );
    expect(await providerNames()).toContain('Acme');
  });

  it('ignores unrelated keys instead of silently cancelling', async () => {
    const { stdin, lastFrame } = await openConfirm();
    stdin.write('x');
    await settle();
    expect(lastFrame()).toContain('Delete provider');
    expect(await providerNames()).toContain('Acme');
  });
});

describe('Profiles delete confirmation', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-profiles-del-'));
    await setupProvider();
    const { addProfile } = await import('../../profiles/profile-manager.js');
    const providers = await (await import('../../providers/provider-manager.js')).listProviders();
    await addProfile({
      name: 'defaults',
      models: [{ providerId: providers[0]!.id, model: 'm1' }],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('deletes the profile on Enter', async () => {
    const { Profiles } = await import('./Profiles.js');
    const { stdin, lastFrame } = render(<Profiles onBack={() => {}} />);
    await poll(lastFrame, (f) => f.includes('defaults'), 'profile list loaded');
    await settle();
    stdin.write('d');
    await poll(lastFrame, (f) => f.includes('Delete profile'), 'confirm shown');
    await settle();
    stdin.write('\r');
    const { listProfiles } = await import('../../profiles/profile-manager.js');
    const deadline = Date.now() + 2000;
    for (;;) {
      if (!(await listProfiles()).some((p) => p.name === 'defaults')) break;
      if (Date.now() > deadline) throw new Error('profile was not deleted on Enter');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('confirms profile deletion via Enter when the last model was removed', async () => {
    const { Profiles } = await import('./Profiles.js');
    const { stdin, lastFrame } = render(<Profiles onBack={() => {}} />);
    await poll(lastFrame, (f) => f.includes('defaults'), 'profile list loaded');
    await settle();

    stdin.write('\r'); // open detail
    await poll(lastFrame, (f) => f.includes('m1'), 'detail shown');
    await settle();

    stdin.write('e'); // edit
    await poll(lastFrame, (f) => f.includes('Edit Profile'), 'edit shown');
    await settle();
    stdin.write('\t'); // focus -> models
    await settle();
    stdin.write('d'); // remove the only model
    await poll(
      lastFrame,
      (f) => f.includes('[+ add') && !f.includes('m1 '),
      'model removed in editor',
    );
    await settle();
    stdin.write('s'); // focus save
    await settle();
    stdin.write('s'); // save -> empty-models confirmation
    await poll(lastFrame, (f) => f.includes('Profile has no models'), 'confirmation shown');
    await settle();
    stdin.write('\r');
    const { listProfiles } = await import('../../profiles/profile-manager.js');
    const deadline = Date.now() + 2000;
    for (;;) {
      if ((await listProfiles()).length === 0) break;
      if (Date.now() > deadline) {
        throw new Error(`profile survived empty-model confirm; last frame:\n${lastFrame()}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('explains why the last model cannot be removed in the detail view', async () => {
    const { Profiles } = await import('./Profiles.js');
    const { stdin, lastFrame } = render(<Profiles onBack={() => {}} />);
    await poll(lastFrame, (f) => f.includes('defaults'), 'profile list loaded');
    await settle();
    stdin.write('\r'); // open detail
    await poll(lastFrame, (f) => f.includes('m1'), 'detail shown');
    await settle();

    stdin.write('d');
    await poll(lastFrame, (f) => f.includes('last model'), 'explanatory status shown');
    const { listProfiles } = await import('../../profiles/profile-manager.js');
    expect((await listProfiles()).some((p) => p.name === 'defaults')).toBe(true);
  });
});
