import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let homeDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => homeDir) };
});

const PROVIDER_ID = '00000000-0000-0000-0000-0000000000b1';

async function seed(): Promise<void> {
  const { writeConfig } = await import('../../config/store.js');
  await writeConfig({
    providers: [
      {
        id: PROVIDER_ID,
        name: 'Acme',
        type: 'openai-compatible',
        apiKey: 'sk-secret-key',
        baseUrl: 'https://api.example.com/v1',
        models: [{ name: 'm1', capabilities: { image: true, video: false, audio: false } }],
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

async function run(args: string[]): Promise<void> {
  const { createProviderCommand } = await import('./provider.js');
  await createProviderCommand().parseAsync(args, { from: 'user' });
}

describe('agento provider CLI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-provider-cli-'));
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seed();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(homeDir, { recursive: true, force: true });
  });

  it('lists providers as JSON with a masked key', async () => {
    await run(['list', '--json']);

    expect(process.exitCode).toBe(0);
    const output = String(logSpy.mock.calls[0]?.[0]);
    expect(output).toContain(PROVIDER_ID);
    expect(output).not.toContain('sk-secret-key');
    expect(output).toContain('••••••••-key');
  });

  it('edits a provider by name', async () => {
    await run(['edit', 'acme', '-n', 'Acme 2', '-M', 'm1,m2']);

    expect(process.exitCode).toBe(0);
    const { listProviders } = await import('../../providers/provider-manager.js');
    const [updated] = await listProviders();
    expect(updated!.name).toBe('Acme 2');
    expect(updated!.models.map((model) => model.name)).toEqual(['m1', 'm2']);
  });

  it('tests a provider through a mocked /models endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }),
      }),
    );

    await run(['test', 'Acme']);

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain('OK — 2 models');
  });

  it('adds a provider with --fetch-models', async () => {
    const { writeConfig } = await import('../../config/store.js');
    await writeConfig({
      providers: [],
      profiles: [],
      settings: {
        defaultLaunchMode: 'child',
        defaultConfigScope: 'project',
        mergeAgentConfigs: true,
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }),
      }),
    );

    await run([
      'add',
      '-n',
      'Fetched',
      '-t',
      'openai-compatible',
      '-k',
      'sk-x',
      '-u',
      'https://api.example.com/v1',
      '--fetch-models',
    ]);

    expect(process.exitCode).toBe(0);
    const { listProviders } = await import('../../providers/provider-manager.js');
    const providers = await listProviders();
    expect(providers[0]!.models.map((model) => model.name)).toEqual(['a', 'b']);
  });
});
