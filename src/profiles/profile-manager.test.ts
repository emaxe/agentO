import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

let testDir = '';
let _seedCount = 0;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => testDir),
  };
});

beforeEach(async () => {
  _seedCount = 0;
  vi.resetModules();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function getManager() {
  return await import('./profile-manager.js');
}

/** Creates a real provider in the store and returns its id. Uses a unique name per call to avoid collisions. */
async function seedProvider(): Promise<string> {
  const { addProvider } = await import('../providers/provider-manager.js');
  const p = await addProvider({
    name: `SeedProvider-${++_seedCount}`,
    type: 'anthropic-compatible',
    apiKey: 'seed-key',
    models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }],
  });
  return p.id;
}

describe('profile manager', () => {
  it('add then list contains the profile', async () => {
    const providerId = await seedProvider();
    const { addProfile, listProfiles } = await getManager();
    await addProfile({ name: 'MyProfile', models: [{ providerId, model: 'gpt-4' }] });
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('MyProfile');
  });

  it('remove then list does not contain the profile', async () => {
    const providerId = await seedProvider();
    const { addProfile, listProfiles, removeProfile } = await getManager();
    const p = await addProfile({ name: 'ToDelete', models: [{ providerId, model: 'm' }] });
    await removeProfile(p.id);
    expect(await listProfiles()).toHaveLength(0);
  });

  it('remove by name works', async () => {
    const providerId = await seedProvider();
    const { addProfile, listProfiles, removeProfile } = await getManager();
    await addProfile({ name: 'ByName', models: [{ providerId, model: 'm2' }] });
    await removeProfile('ByName');
    expect(await listProfiles()).toHaveLength(0);
  });

  describe('domain validation', () => {
    it('addProfile with unknown providerId throws', async () => {
      const { addProfile, listProfiles } = await getManager();
      await expect(
        addProfile({ name: 'BadProfile', models: [{ providerId: '00000000-0000-0000-0000-000000000099', model: 'm' }] }),
      ).rejects.toThrow('unknown providerId');
      expect(await listProfiles()).toHaveLength(0);
    });

    it('addProfile with multiple models missing tier throws', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await expect(
        addProfile({
          name: 'MultiNoTier',
          models: [
            { providerId, model: 'm1' },
            { providerId, model: 'm2' },
          ],
        }),
      ).rejects.toThrow('missing a tier');
      expect(await listProfiles()).toHaveLength(0);
    });

    it('addProfile with duplicate tiers throws', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await expect(
        addProfile({
          name: 'DupTier',
          models: [
            { providerId, model: 'm1', tier: 'base' },
            { providerId, model: 'm2', tier: 'base' },
          ],
        }),
      ).rejects.toThrow('duplicate tiers');
      expect(await listProfiles()).toHaveLength(0);
    });

    it('addProfile multi-model without base tier throws', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await expect(
        addProfile({
          name: 'NoBase',
          models: [
            { providerId, model: 'm1', tier: 'small' },
            { providerId, model: 'm2', tier: 'smart' },
          ],
        }),
      ).rejects.toThrow('tier=base');
      expect(await listProfiles()).toHaveLength(0);
    });

    it('addProfile with duplicate name throws', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await addProfile({ name: 'Unique', models: [{ providerId, model: 'm' }] });
      await expect(
        addProfile({ name: 'Unique', models: [{ providerId, model: 'm2' }] }),
      ).rejects.toThrow('already in use');
      expect(await listProfiles()).toHaveLength(1);
    });

    it('addProfile valid single-model without tier succeeds', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await addProfile({ name: 'SingleModel', models: [{ providerId, model: 'm' }] });
      expect(await listProfiles()).toHaveLength(1);
    });

    it('addProfile valid multi-model with unique tiers including base succeeds', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await addProfile({
        name: 'MultiModel',
        models: [
          { providerId, model: 'm1', tier: 'base' },
          { providerId, model: 'm2', tier: 'small' },
        ],
      });
      expect(await listProfiles()).toHaveLength(1);
    });

    it('addProfile with models from different providers throws', async () => {
      const { addProvider } = await import('../providers/provider-manager.js');
      const p1 = await addProvider({
        name: 'Provider-1',
        type: 'anthropic-compatible',
        apiKey: 'k1',
        models: [{ name: 'm1', capabilities: { image: false, video: false, audio: false } }],
      });
      const p2 = await addProvider({
        name: 'Provider-2',
        type: 'anthropic-compatible',
        apiKey: 'k2',
        models: [{ name: 'm2', capabilities: { image: false, video: false, audio: false } }],
      });
      const { addProfile, listProfiles } = await getManager();
      await expect(
        addProfile({
          name: 'CrossProvider',
          models: [
            { providerId: p1.id, model: 'm1', tier: 'base' },
            { providerId: p2.id, model: 'm2', tier: 'small' },
          ],
        }),
      ).rejects.toThrow('same provider');
      expect(await listProfiles()).toHaveLength(0);
    });

    it('addProfile with multiple models from same provider succeeds', async () => {
      const { addProfile, listProfiles } = await getManager();
      const providerId = await seedProvider();
      await addProfile({
        name: 'SameProviderMulti',
        models: [
          { providerId, model: 'm1', tier: 'base' },
          { providerId, model: 'm2', tier: 'small' },
        ],
      });
      expect(await listProfiles()).toHaveLength(1);
    });
  });
});
