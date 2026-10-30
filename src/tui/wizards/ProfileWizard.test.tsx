/**
 * The profile wizard must never offer a tier choice that validation will
 * reject later: a used tier, or "no tier" for a multi-model profile.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ProfileWizard } from './ProfileWizard.js';
import type { Provider } from '../../config/schema.js';

const provider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme',
  type: 'openai-compatible',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  models: [
    { name: 'm1', capabilities: { image: true, video: false, audio: false } },
    { name: 'm2', capabilities: { image: true, video: false, audio: false } },
  ],
};

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

const settle = () => new Promise((r) => setTimeout(r, 80));

describe('ProfileWizard tier choices', () => {
  it('hides used tiers and the skip option once the profile has a model', async () => {
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(
      <ProfileWizard providers={[provider]} profiles={[]} onDone={onDone} onCancel={() => {}} />,
    );

    await settle();
    stdin.write('work');
    await settle();
    stdin.write('\r');
    await poll(lastFrame, (f) => f.includes('Select provider'), 'provider step');
    await settle();
    stdin.write('\r'); // select Acme
    await poll(lastFrame, (f) => f.includes('Select model'), 'model step');
    await settle();
    stdin.write('\r'); // select m1
    await poll(lastFrame, (f) => f.includes('Assign tier'), 'tier step');
    await settle();

    const firstTier = await poll(
      lastFrame,
      (f) => f.includes('skip (single-model profile)'),
      'skip offered for the first model',
    );
    expect(firstTier).toContain('small');
    expect(firstTier).toContain('base');
    expect(firstTier).toContain('smart');

    // Default cursor is base; move up to small and confirm.
    stdin.write('\u001B[A');
    await settle();
    stdin.write('\r');
    await poll(lastFrame, (f) => f.includes('[✓ Save profile]'), 'review after first model');
    await settle();

    stdin.write('\r'); // add another model
    await poll(lastFrame, (f) => f.includes('Select model'), 'model step again');
    await settle();
    stdin.write('\u001B[B'); // m2
    await settle();
    stdin.write('\r');
    const secondTier = await poll(lastFrame, (f) => f.includes('Assign tier'), 'second tier step');
    const hasTierRow = (frame: string, tier: string): boolean =>
      frame.split('\n').some((line) => line.trim() === tier || line.trim() === `▶ ${tier}`);
    expect(hasTierRow(secondTier, 'small')).toBe(false);
    expect(hasTierRow(secondTier, 'skip (single-model profile)')).toBe(false);
    expect(hasTierRow(secondTier, 'base')).toBe(true);
    expect(hasTierRow(secondTier, 'smart')).toBe(true);

    await settle();
    stdin.write('\r'); // base
    await poll(lastFrame, (f) => f.includes('[✓ Save profile]'), 'review after second model');
    await settle();

    stdin.write('\u001B[B'); // move to Save
    await settle();
    stdin.write('\r');
    const deadline = Date.now() + 2000;
    while (onDone.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(onDone).toHaveBeenCalledWith({
      name: 'work',
      models: [
        { providerId: provider.id, model: 'm1', tier: 'small' },
        { providerId: provider.id, model: 'm2', tier: 'base' },
      ],
    });
  });

  it('asks for a tier for an untiered model before adding a second one', async () => {
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(
      <ProfileWizard providers={[provider]} profiles={[]} onDone={onDone} onCancel={() => {}} />,
    );

    await settle();
    stdin.write('work');
    await settle();
    stdin.write('\r');
    await poll(lastFrame, (f) => f.includes('Select provider'), 'provider step');
    await settle();
    stdin.write('\r');
    await poll(lastFrame, (f) => f.includes('Select model'), 'model step');
    await settle();
    stdin.write('\r'); // m1
    await poll(lastFrame, (f) => f.includes('Assign tier'), 'tier step');
    await settle();

    // default cursor is base; move to "skip" and keep a single untiered model
    stdin.write('\u001B[B');
    await settle();
    stdin.write('\u001B[B');
    await settle();
    stdin.write('\r');
    await poll(lastFrame, (f) => f.includes('[✓ Save profile]'), 'review with untiered model');
    await settle();

    stdin.write('\r'); // add another model
    const assignTier = await poll(
      lastFrame,
      (f) => f.includes('Assign tier') && f.includes('m1'),
      'tier step for the existing untiered model',
    );
    expect(assignTier).not.toContain('skip (single-model profile)');

    await settle();
    stdin.write('\r'); // base for m1
    await poll(lastFrame, (f) => f.includes('Select model'), 'model step after tier assignment');
    await settle();
    stdin.write('\u001B[B'); // m2
    await settle();
    stdin.write('\r');
    const secondTier = await poll(
      lastFrame,
      (f) => f.includes('Assign tier') && f.includes('m2'),
      'tier step for the second model',
    );
    const hasTierRow = (frame: string, tier: string): boolean =>
      frame.split('\n').some((line) => line.trim() === tier || line.trim() === `▶ ${tier}`);
    expect(hasTierRow(secondTier, 'base')).toBe(false);
    expect(hasTierRow(secondTier, 'small')).toBe(true);

    await settle();
    stdin.write('\r'); // small
    await poll(lastFrame, (f) => f.includes('[✓ Save profile]'), 'review after two models');
    await settle();
    stdin.write('\u001B[B');
    await settle();
    stdin.write('\r');

    const deadline = Date.now() + 2000;
    while (onDone.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(onDone).toHaveBeenCalledWith({
      name: 'work',
      models: [
        { providerId: provider.id, model: 'm1', tier: 'base' },
        { providerId: provider.id, model: 'm2', tier: 'small' },
      ],
    });
  });
});
