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
  return await import('./provider-manager.js');
}

describe('provider manager', () => {
  it('add then list contains the provider', async () => {
    const { addProvider, listProviders } = await getManager();
    await addProvider({ name: 'Test', type: 'anthropic', apiKey: 'key123', models: ['claude-3'] });
    const providers = await listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('Test');
  });

  it('remove then list does not contain the provider', async () => {
    const { addProvider, listProviders, removeProvider } = await getManager();
    const p = await addProvider({ name: 'ToDelete', type: 'openai-compatible', apiKey: 'k', models: ['gpt-4'] });
    await removeProvider(p.id);
    const providers = await listProviders();
    expect(providers).toHaveLength(0);
  });

  it('remove by name works', async () => {
    const { addProvider, listProviders, removeProvider } = await getManager();
    await addProvider({ name: 'ByName', type: 'anthropic', apiKey: 'k', models: ['m1'] });
    await removeProvider('ByName');
    expect(await listProviders()).toHaveLength(0);
  });

  it('remove non-existent throws', async () => {
    const { removeProvider } = await getManager();
    await expect(removeProvider('nonexistent')).rejects.toThrow('Provider not found');
  });
});
