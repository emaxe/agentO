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
  async function seedMultiModelProfile() {
    const providerId = await seedProvider();
    const { addProfile } = await getManager();
    return addProfile({
      name: 'Work',
      models: [
        { providerId, model: 'small-model', tier: 'small' },
        { providerId, model: 'base-model', tier: 'base' },
        { providerId, model: 'smart-model', tier: 'smart' },
      ],
    });
  }

  describe('editing and lookup', () => {
    it('updates a profile in place, preserves its id and leaves other config intact', async () => {
      const profile = await seedMultiModelProfile();
      const { addProfile, updateProfile, listProfiles } = await getManager();
      const other = await addProfile({ name: 'Other', models: [profile.models[0]] });
      const { readConfig } = await import('../config/store.js');
      const before = await readConfig();
      const updated = await updateProfile(profile.id, { name: 'Renamed' });
      expect(updated).toEqual({ ...profile, name: 'Renamed' });
      expect(await listProfiles()).toEqual([updated, other]);
      const after = await readConfig();
      expect(after.providers).toEqual(before.providers);
      expect(after.settings).toEqual(before.settings);
    });

    it('allows keeping the current name when updating models', async () => {
      const profile = await seedMultiModelProfile();
      const { updateProfile, findProfile } = await getManager();
      const models = [profile.models[1]];
      await updateProfile(profile.id, { name: profile.name, models });
      expect(await findProfile(profile.id)).toEqual({ ...profile, models });
    });

    it.each(['duplicate name', 'unknown provider', 'duplicate tiers', 'no base', 'empty models'])(
      'rejects an update with %s and preserves the stored config',
      async (scenario) => {
        const profile = await seedMultiModelProfile();
        const { addProfile, updateProfile } = await getManager();
        await addProfile({ name: 'Taken', models: [profile.models[0]] });
        const { readConfig } = await import('../config/store.js');
        const before = await readConfig();
        const updates = {
          'duplicate name': { name: 'Taken' },
          'unknown provider': {
            models: [{ ...profile.models[0], providerId: '00000000-0000-0000-0000-000000000099' }],
          },
          'duplicate tiers': { models: [profile.models[1], profile.models[1]] },
          'no base': { models: [profile.models[0], profile.models[2]] },
          'empty models': { models: [] },
        }[scenario]!;
        await expect(updateProfile(profile.id, updates)).rejects.toThrow();
        expect(await readConfig()).toEqual(before);
      },
    );

    it('finds profiles by id or name and returns undefined for an unknown profile', async () => {
      const profile = await seedMultiModelProfile();
      const { findProfile } = await getManager();
      expect(await findProfile(profile.id)).toEqual(profile);
      expect(await findProfile(profile.name)).toEqual(profile);
      expect(await findProfile('missing')).toBeUndefined();
    });

    it('rejects update and removal of an unknown profile without changing existing data', async () => {
      await seedMultiModelProfile();
      const { updateProfile, removeProfile, listProfiles } = await getManager();
      const before = await listProfiles();
      await expect(updateProfile('missing', { name: 'New' })).rejects.toThrow('Profile not found');
      await expect(removeProfile('missing')).rejects.toThrow('Profile not found');
      expect(await listProfiles()).toEqual(before);
    });
  });

  describe('model ordering', () => {
    it.each(['up', 'down'] as const)(
      'moves a model %s, preserving tiers and other profiles',
      async (direction) => {
        const profile = await seedMultiModelProfile();
        const { addProfile, moveModelUp, moveModelDown, listProfiles } = await getManager();
        const other = await addProfile({ name: 'Other', models: [profile.models[0]] });
        const updated = await (direction === 'up' ? moveModelUp : moveModelDown)(profile.id, 1);
        const expected =
          direction === 'up'
            ? [profile.models[1], profile.models[0], profile.models[2]]
            : [profile.models[0], profile.models[2], profile.models[1]];
        expect(updated).toEqual({ ...profile, models: expected });
        expect(await listProfiles()).toEqual([updated, other]);
      },
    );

    it.each([
      ['up', -1],
      ['up', 0],
      ['up', 3],
      ['down', -1],
      ['down', 2],
      ['down', 3],
    ] as const)(
      'ignores moving %s from boundary/out-of-range index %i',
      async (direction, index) => {
        const profile = await seedMultiModelProfile();
        const { moveModelUp, moveModelDown, listProfiles } = await getManager();
        const move = direction === 'up' ? moveModelUp : moveModelDown;
        expect(await move(profile.id, index)).toEqual(profile);
        expect(await listProfiles()).toEqual([profile]);
      },
    );

    it('rejects reordering an unknown profile', async () => {
      const { moveModelUp, moveModelDown } = await getManager();
      await expect(moveModelUp('missing', 1)).rejects.toThrow('Profile not found');
      await expect(moveModelDown('missing', 0)).rejects.toThrow('Profile not found');
    });
  });

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
        addProfile({
          name: 'BadProfile',
          models: [{ providerId: '00000000-0000-0000-0000-000000000099', model: 'm' }],
        }),
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
