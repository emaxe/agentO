/**
 * Render coverage for the TUI screens, which had none at all.
 *
 * These are deliberately shallow — they assert what the user sees, not
 * implementation detail — but they catch the failure mode that matters for a
 * terminal UI: a screen that throws on some shape of data and takes the whole
 * app down, or one that leaks a secret into the frame.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ProfileList } from './ProfileList.js';
import { ProviderList } from './ProviderList.js';
import { ProfileSelect } from './ProfileSelect.js';
import type { Profile, Provider } from '../../config/schema.js';

const noop = (): void => {};

const providers: Provider[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Fireworks',
    type: 'fireworks',
    apiKey: 'fw-super-secret-key-value',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: [
      { name: 'llama-70b', capabilities: { image: true, video: false, audio: false } },
      { name: 'kimi-k2', capabilities: { image: false, video: false, audio: false } },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'No URL',
    type: 'anthropic-compatible',
    apiKey: 'sk-ant-x',
    models: [{ name: 'claude', capabilities: { image: true, video: true, audio: true } }],
  },
];

const profiles: Profile[] = [
  { id: '00000000-0000-0000-0000-000000000010', name: 'solo', models: [{ providerId: providers[0]!.id, model: 'llama-70b' }] },
  {
    id: '00000000-0000-0000-0000-000000000011',
    name: 'tiered',
    models: [
      { providerId: providers[0]!.id, model: 'kimi-k2', tier: 'small' },
      { providerId: providers[0]!.id, model: 'llama-70b', tier: 'base' },
    ],
  },
];

describe('ProfileList', () => {
  it('lists profiles with their model count and marks the selection', () => {
    const { lastFrame } = render(
      <ProfileList profiles={profiles} selected={1} onSelect={noop} onAdd={noop} onDelete={noop} onBack={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('solo (1 models)');
    expect(frame).toContain('▶ ');
    expect(frame.split('\n').find((l) => l.includes('tiered'))).toContain('▶');
  });

  it('shows the empty state rather than a blank screen', () => {
    const { lastFrame } = render(
      <ProfileList profiles={[]} selected={0} onSelect={noop} onAdd={noop} onDelete={noop} onBack={noop} />,
    );
    expect(lastFrame()).toContain('No profiles');
  });

  it('renders the status line when one is set', () => {
    const { lastFrame } = render(
      <ProfileList profiles={profiles} selected={0} status="Saved." onSelect={noop} onAdd={noop} onDelete={noop} onBack={noop} />,
    );
    expect(lastFrame()).toContain('Saved.');
  });
});

describe('ProviderList', () => {
  it('never renders the full API key', () => {
    const { lastFrame } = render(
      <ProviderList providers={providers} selected={0} onSelect={noop} onAdd={noop} onEdit={noop} onDelete={noop} onBack={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('fw-super-secret-key-value');
    expect(frame).toContain('fw-super');
  });

  it('shows capability markers for the selected provider only', () => {
    const { lastFrame } = render(
      <ProviderList providers={providers} selected={0} onSelect={noop} onAdd={noop} onEdit={noop} onDelete={noop} onBack={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[i--] llama-70b');
    expect(frame).toContain('[---] kimi-k2');
    // The unselected provider shows its name but not its model detail.
    expect(frame).toContain('No URL (anthropic-compatible)');
    expect(frame).not.toContain('[iva]');
  });

  it('renders a provider with no baseUrl without crashing', () => {
    const { lastFrame } = render(
      <ProviderList providers={providers} selected={1} onSelect={noop} onAdd={noop} onEdit={noop} onDelete={noop} onBack={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[iva] claude');
    expect(frame).not.toContain('url:');
  });

  it('offers the add row when the list is empty', () => {
    const { lastFrame } = render(
      <ProviderList providers={[]} selected={0} onSelect={noop} onAdd={noop} onEdit={noop} onDelete={noop} onBack={noop} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No providers');
    expect(frame).toContain('[+ Add provider]');
  });
});

describe('ProfileSelect', () => {
  it('renders the profile list for the launch wizard', () => {
    const { lastFrame } = render(<ProfileSelect profiles={profiles} selected={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('solo');
    expect(frame).toContain('tiered');
  });

  it('handles an empty profile list', () => {
    expect(() => render(<ProfileSelect profiles={[]} selected={0} />)).not.toThrow();
  });
});
