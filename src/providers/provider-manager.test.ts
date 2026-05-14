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
    await addProvider({ name: 'Test', type: 'anthropic-compatible', apiKey: 'key123', models: [{ name: 'claude-3', capabilities: { image: true, video: false, audio: false } }] });
    const providers = await listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('Test');
  });

  it('remove then list does not contain the provider', async () => {
    const { addProvider, listProviders, removeProvider } = await getManager();
    const p = await addProvider({ name: 'ToDelete', type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://api.example.com', models: [{ name: 'gpt-4', capabilities: { image: true, video: false, audio: false } }] });
    await removeProvider(p.id);
    const providers = await listProviders();
    expect(providers).toHaveLength(0);
  });

  it('remove by name works', async () => {
    const { addProvider, listProviders, removeProvider } = await getManager();
    await addProvider({ name: 'ByName', type: 'anthropic-compatible', apiKey: 'k', models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }] });
    await removeProvider('ByName');
    expect(await listProviders()).toHaveLength(0);
  });

  it('remove non-existent throws', async () => {
    const { removeProvider } = await getManager();
    await expect(removeProvider('nonexistent')).rejects.toThrow('Provider not found');
  });

  describe('domain validation', () => {
    it('addProvider with invalid type throws before writing', async () => {
      const { addProvider, listProviders } = await getManager();
      await expect(
        addProvider({ name: 'Bad', type: 'invalid-type', apiKey: 'k', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('Invalid provider type: "invalid-type"');
      expect(await listProviders()).toHaveLength(0);
    });

    it('addProvider openai-compatible without baseUrl throws', async () => {
      const { addProvider, listProviders } = await getManager();
      await expect(
        addProvider({ name: 'Compat', type: 'openai-compatible', apiKey: 'k', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('requires a baseUrl');
      expect(await listProviders()).toHaveLength(0);
    });

    it('addProvider with duplicate name throws', async () => {
      const { addProvider, listProviders } = await getManager();
      await addProvider({ name: 'Dup', type: 'anthropic-compatible', apiKey: 'k', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] });
      await expect(
        addProvider({ name: 'Dup', type: 'anthropic-compatible', apiKey: 'k2', models: [{ name: 'm2', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('already in use');
      expect(await listProviders()).toHaveLength(1);
    });

    it('addProvider responses-compatible without baseUrl throws', async () => {
      const { addProvider, listProviders } = await getManager();
      await expect(
        addProvider({ name: 'Responses', type: 'responses-compatible', apiKey: 'k', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('requires a baseUrl');
      expect(await listProviders()).toHaveLength(0);
    });

    it('addProvider valid openai-compatible with baseUrl succeeds', async () => {
      const { addProvider, listProviders } = await getManager();
      await addProvider({ name: 'Valid', type: 'openai-compatible', apiKey: 'k', baseUrl: 'https://api.example.com', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] });
      expect(await listProviders()).toHaveLength(1);
    });

    it('addProvider valid responses-compatible with baseUrl succeeds', async () => {
      const { addProvider, listProviders } = await getManager();
      await addProvider({ name: 'ResponsesValid', type: 'responses-compatible', apiKey: 'k', baseUrl: 'https://api.example.com', models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] });
      expect(await listProviders()).toHaveLength(1);
    });

    it('addProvider custom-api without baseUrl throws', async () => {
      const { addProvider, listProviders } = await getManager();
      await expect(
        addProvider({ name: 'Custom', type: 'custom-api', apiKey: 'k', customApiModes: { openai: true, anthropic: false, responses: false }, models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('requires a baseUrl');
      expect(await listProviders()).toHaveLength(0);
    });

    it('addProvider custom-api without any enabled mode throws', async () => {
      const { addProvider, listProviders } = await getManager();
      await expect(
        addProvider({ name: 'Custom', type: 'custom-api', apiKey: 'k', baseUrl: 'https://api.example.com', customApiModes: { openai: false, anthropic: false, responses: false }, models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] }),
      ).rejects.toThrow('requires at least one API mode');
      expect(await listProviders()).toHaveLength(0);
    });

    it('addProvider valid custom-api with baseUrl and modes succeeds', async () => {
      const { addProvider, listProviders } = await getManager();
      await addProvider({ name: 'CustomValid', type: 'custom-api', apiKey: 'k', baseUrl: 'https://api.example.com', customApiModes: { openai: true, anthropic: false, responses: false }, models: [{ name: 'm', capabilities: { image: true, video: false, audio: false } }] });
      expect(await listProviders()).toHaveLength(1);
    });
  });
});
