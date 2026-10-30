import { describe, expect, it } from 'vitest';
import { launchFingerprint } from './launch-confirmation.js';
import { copilotAdapter } from '../adapters/copilot.js';
import type { DescribeLaunchOptions, LaunchPreview } from '../launcher/preview.js';
import { p } from '../test-utils/paths.js';

const options: DescribeLaunchOptions = {
  adapter: copilotAdapter,
  profile: { id: 'p', name: 'work', models: [{ providerId: 's', model: 'm1' }] },
  providers: [
    {
      id: 's',
      name: 'Service',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-secret',
      models: [],
    },
  ],
  mode: 'child',
  scope: 'project',
  cwd: p('work', 'project'),
};
const preview = { files: [] } as unknown as LaunchPreview;

describe('launch confirmation invalidation', () => {
  it.each([
    ['model', { profile: { ...options.profile, models: [{ providerId: 's', model: 'm2' }] } }],
    ['key', { providers: [{ ...options.providers[0]!, apiKey: 'sk-changed' }] }],
    [
      'endpoint',
      { providers: [{ ...options.providers[0]!, baseUrl: 'https://other.example.test/v1' }] },
    ],
    ['mode', { mode: 'independent' }],
    ['scope', { scope: 'global' }],
    ['directory', { cwd: p('work', 'other') }],
  ] as [string, Partial<DescribeLaunchOptions>][])(
    'requires review after changing %s',
    (_label, changed) => {
      expect(launchFingerprint({ ...options, ...changed }, preview, true)).not.toBe(
        launchFingerprint(options, preview, true),
      );
    },
  );
  it('covers merge settings and actual config paths', () => {
    const original = launchFingerprint(options, preview, true);
    expect(launchFingerprint(options, preview, false)).not.toBe(original);
    expect(
      launchFingerprint(
        options,
        { ...preview, files: [{ path: p('config', 'other'), action: 'update' }] },
        true,
      ),
    ).not.toBe(original);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(original).not.toContain('sk-secret');
  });
});
