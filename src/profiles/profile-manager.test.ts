import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

let testDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => testDir),
  };
});

beforeEach(async () => {
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

describe('profile manager', () => {
  it('add then list contains the profile', async () => {
    const { addProfile, listProfiles } = await getManager();
    await addProfile({ name: 'MyProfile', models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'gpt-4' }] });
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('MyProfile');
  });

  it('remove then list does not contain the profile', async () => {
    const { addProfile, listProfiles, removeProfile } = await getManager();
    const p = await addProfile({ name: 'ToDelete', models: [{ providerId: '00000000-0000-0000-0000-000000000001', model: 'm' }] });
    await removeProfile(p.id);
    expect(await listProfiles()).toHaveLength(0);
  });

  it('remove by name works', async () => {
    const { addProfile, listProfiles, removeProfile } = await getManager();
    await addProfile({ name: 'ByName', models: [{ providerId: '00000000-0000-0000-0000-000000000002', model: 'm2' }] });
    await removeProfile('ByName');
    expect(await listProfiles()).toHaveLength(0);
  });
});
