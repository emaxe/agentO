/**
 * Tests for `agento profile add` model spec parsing.
 *
 * The `-m "providerId:model"` format forced users to paste UUIDs into the
 * shell. A provider *name* must work identically, while raw UUIDs stay
 * supported — and a typo must be a clear error, not a silent broken profile.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let homeDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

const PROVIDER_ID = '00000000-0000-0000-0000-0000000000a1';

async function seed(): Promise<void> {
  const { writeConfig } = await import('../../config/store.js');
  await writeConfig({
    providers: [
      {
        id: PROVIDER_ID,
        name: 'Acme',
        type: 'openai-compatible',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        models: [{ name: 'gpt-big', capabilities: { image: true, video: false, audio: false } }],
      },
    ],
    profiles: [],
    settings: {
      defaultLaunchMode: 'child',
      defaultConfigScope: 'project',
      mergeAgentConfigs: true,
    },
  });
}

async function runAdd(models: string): Promise<void> {
  const { createProfileCommand } = await import('./profile.js');
  await createProfileCommand().parseAsync(['add', '-n', 'work', '-m', models], { from: 'user' });
}

async function savedModel(): Promise<{ providerId: string; model: string }> {
  const { listProfiles } = await import('../../profiles/profile-manager.js');
  return (await listProfiles())[0]!.models[0]!;
}

describe('agento profile add', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-profile-cli-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await seed();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('resolves a provider by name', async () => {
    await runAdd('Acme:gpt-big');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(await savedModel()).toEqual({ providerId: PROVIDER_ID, model: 'gpt-big' });
  });

  it('resolves a provider by name case-insensitively', async () => {
    await runAdd('acme:gpt-big');
    expect(await savedModel()).toEqual({ providerId: PROVIDER_ID, model: 'gpt-big' });
  });

  it('still accepts a raw provider UUID', async () => {
    await runAdd(`${PROVIDER_ID}:gpt-big`);
    expect(await savedModel()).toEqual({ providerId: PROVIDER_ID, model: 'gpt-big' });
  });

  it('keeps tier parsing with a name reference', async () => {
    const { createProfileCommand } = await import('./profile.js');
    await createProfileCommand().parseAsync(
      ['add', '-n', 'tiered', '-m', 'Acme:gpt-big:base,Acme:other:smart'],
      { from: 'user' },
    );
    const { listProfiles } = await import('../../profiles/profile-manager.js');
    const profile = (await listProfiles()).find((x) => x.name === 'tiered')!;
    expect(profile.models.map((m) => m.tier)).toEqual(['base', 'smart']);
    expect(profile.models.every((m) => m.providerId === PROVIDER_ID)).toBe(true);
  });

  it('rejects an unknown provider with a helpful error', async () => {
    await runAdd('NoSuchProvider:gpt-big');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const message = errorSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(message).toMatch(/NoSuchProvider/);
    expect(message).toMatch(/provider|name/i);
  });
});
