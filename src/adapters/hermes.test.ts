import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesAdapter, hermesProviderKey, mergeHermesConfig } from './hermes.js';
import type { Profile, Provider } from '../config/schema.js';
import { posix, win32 } from '../test-utils/paths.js';

const cli = new HermesAdapter({ id: 'hermes', displayName: 'Hermes Agent' });
const desktop = new HermesAdapter({ id: 'hermes-desktop', displayName: 'Hermes Desktop' });

const openaiProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme Cloud',
  type: 'openai-compatible',
  apiKey: 'sk-acme',
  baseUrl: 'https://api.acme.test/v1',
  models: [{ name: 'acme-large', capabilities: { image: true, video: false, audio: false } }],
};

const anthropicProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000002',
  name: 'Anthropic',
  type: 'anthropic-compatible',
  apiKey: 'sk-ant',
  models: [
    { name: 'claude-sonnet-4-6', capabilities: { image: true, video: false, audio: false } },
  ],
};

const responsesProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000003',
  name: 'Responses API',
  type: 'responses-compatible',
  apiKey: 'sk-resp',
  baseUrl: 'https://responses.test/v1',
  models: [{ name: 'resp-large', capabilities: { image: true, video: false, audio: false } }],
};

const fireworksProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000004',
  name: 'Fireworks AI',
  type: 'fireworks',
  apiKey: 'fw-test',
  models: [{ name: 'fw-model', capabilities: { image: false, video: false, audio: false } }],
};

const customNoneProvider: Provider = {
  id: '00000000-0000-0000-0000-000000000005',
  name: 'No Modes',
  type: 'custom-api',
  apiKey: 'sk-none',
  baseUrl: 'https://none.test',
  models: [{ name: 'none-model', capabilities: { image: false, video: false, audio: false } }],
  customApiModes: { openai: false, anthropic: false, responses: false },
};

const cyrillicProvider: Provider = {
  id: '1234abcd-0000-0000-0000-000000000000',
  name: 'Локальный шлюз',
  type: 'openai-compatible',
  apiKey: 'sk-local',
  baseUrl: 'http://127.0.0.1:8080/v1',
  models: [{ name: 'local-model', capabilities: { image: false, video: false, audio: false } }],
};

function profileFor(provider: Provider, model = provider.models[0]!.name): Profile {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    name: `Test ${provider.name}`,
    models: [{ providerId: provider.id, model }],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('HermesAdapter basics', () => {
  it('registers the CLI and Desktop as separate agents', () => {
    expect(cli.id).toBe('hermes');
    expect(cli.displayName).toBe('Hermes Agent');
    expect(desktop.id).toBe('hermes-desktop');
    expect(desktop.displayName).toBe('Hermes Desktop');
  });

  it('supports every provider type Hermes can speak', () => {
    expect(cli.supportedProviderTypes).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'fireworks',
      'openrouter',
      'responses-compatible',
      'custom-api',
    ]);
  });

  it('uses HERMES_HOME for both scopes', () => {
    vi.stubEnv('HERMES_HOME', '/custom/hermes');
    const adapter = new HermesAdapter({ id: 'hermes', displayName: 'Hermes', home: '/home/u' });
    const paths = adapter.configPaths('/any/project');
    expect(paths.global).toBe(posix('/custom/hermes/config.yaml'));
    expect(paths.project).toBe(paths.global);
  });

  it('defaults to ~/.hermes on POSIX', () => {
    vi.stubEnv('HERMES_HOME', '');
    const adapter = new HermesAdapter({
      id: 'hermes',
      displayName: 'Hermes',
      home: '/home/u',
      platform: 'linux',
    });
    expect(adapter.configPaths().global).toBe(posix('/home/u', '.hermes', 'config.yaml'));
  });

  it('defaults to %LOCALAPPDATA%\\hermes on Windows', () => {
    vi.stubEnv('HERMES_HOME', '');
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\u\\AppData\\Local');
    const adapter = new HermesAdapter({
      id: 'hermes',
      displayName: 'Hermes',
      home: 'C:\\Users\\u',
      platform: 'win32',
    });
    expect(adapter.configPaths().global).toBe(
      win32('C:\\Users\\u\\AppData\\Local', 'hermes', 'config.yaml'),
    );
  });

  it('falls back to AppData\\Local when LOCALAPPDATA is unset', () => {
    vi.stubEnv('HERMES_HOME', '');
    vi.stubEnv('LOCALAPPDATA', '');
    const adapter = new HermesAdapter({
      id: 'hermes',
      displayName: 'Hermes',
      home: 'C:\\Users\\u',
      platform: 'win32',
    });
    expect(adapter.configPaths().global).toBe(
      win32('C:\\Users\\u', 'AppData', 'Local', 'hermes', 'config.yaml'),
    );
  });
});

describe('HermesAdapter.buildConfig', () => {
  it('writes model + providers for OpenAI-compatible endpoints', () => {
    const config = cli.buildConfig(profileFor(openaiProvider), [openaiProvider]);

    expect(config.model).toEqual({
      provider: 'agento-acme-cloud',
      default: 'acme-large',
      base_url: 'https://api.acme.test/v1',
      api_key: 'sk-acme',
    });
    expect(config.providers).toEqual({
      'agento-acme-cloud': {
        name: 'Acme Cloud',
        api: 'https://api.acme.test/v1',
        default_model: 'acme-large',
        models: ['acme-large'],
        api_key: 'sk-acme',
      },
    });
  });

  it('marks Anthropic-compatible providers as anthropic_messages', () => {
    const config = cli.buildConfig(profileFor(anthropicProvider), [anthropicProvider]);
    const entry = config.providers!['agento-anthropic']!;
    expect(entry.transport).toBe('anthropic_messages');
    expect(entry.api).toBe('https://api.anthropic.com');
  });

  it('marks responses-compatible providers as codex_responses', () => {
    const config = cli.buildConfig(profileFor(responsesProvider), [responsesProvider]);
    const entry = config.providers!['agento-responses-api']!;
    expect(entry.transport).toBe('codex_responses');
    expect(entry.api).toBe('https://responses.test/v1');
  });

  it('uses the Fireworks default endpoint when baseUrl is absent', () => {
    const config = cli.buildConfig(profileFor(fireworksProvider), [fireworksProvider]);
    const entry = config.providers!['agento-fireworks-ai']!;
    expect(entry.api).toBe('https://api.fireworks.ai/inference/v1');
    expect(entry.transport).toBeUndefined();
  });

  it.each([
    [
      'openai',
      { openai: true, anthropic: false, responses: false },
      'https://custom.test/v1',
      undefined,
    ],
    [
      'anthropic',
      { openai: false, anthropic: true, responses: false },
      'https://custom.test',
      'anthropic_messages',
    ],
    [
      'responses',
      { openai: false, anthropic: false, responses: true },
      'https://custom.test/v1/responses',
      'codex_responses',
    ],
  ] as const)('maps custom-api %s mode', (mode, modes, url, transport) => {
    const provider: Provider = {
      id: '00000000-0000-0000-0000-000000000006',
      name: `Custom ${mode}`,
      type: 'custom-api',
      apiKey: 'sk-custom',
      baseUrl: 'https://custom.test',
      models: [
        { name: 'custom-model', capabilities: { image: false, video: false, audio: false } },
      ],
      customApiModes: modes,
    };

    const config = cli.buildConfig(profileFor(provider), [provider]);
    const entry = config.providers![`agento-custom-${mode}`]!;
    expect(entry.api).toBe(url);
    expect(entry.transport).toBe(transport);
  });

  it('rejects custom-api providers without an enabled mode', () => {
    expect(() => cli.buildConfig(profileFor(customNoneProvider), [customNoneProvider])).toThrow(
      /requires at least one API mode/,
    );
  });

  it('keeps provider keys ASCII-safe', () => {
    expect(hermesProviderKey(cyrillicProvider)).toBe('agento-1234abcd');
  });

  it('uses the base-tier model of a multi-tier profile', () => {
    const profile: Profile = {
      id: '00000000-0000-0000-0000-000000000098',
      name: 'Tiers',
      models: [
        { providerId: openaiProvider.id, model: 'acme-small', tier: 'small' },
        { providerId: openaiProvider.id, model: 'acme-large', tier: 'base' },
      ],
    };

    const config = cli.buildConfig(profile, [openaiProvider]);
    expect(config.model?.default).toBe('acme-large');
  });
});

describe('HermesAdapter write/read', () => {
  async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), 'hermes-adapter-'));
    try {
      await run(home);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  it('returns null when the config file is missing', async () => {
    await withTempHome(async (home) => {
      const adapter = new HermesAdapter({ id: 'hermes', displayName: 'Hermes', home });
      await expect(adapter.readConfig('global')).resolves.toBeNull();
    });
  });

  it('preserves unrelated keys, model settings and other providers on merge', async () => {
    await withTempHome(async (home) => {
      const adapter = new HermesAdapter({ id: 'hermes', displayName: 'Hermes', home });
      const configPath = adapter.configPaths().global;
      await mkdir(join(home, '.hermes'), { recursive: true });
      await writeFile(
        configPath,
        [
          '_config_version: 23',
          'toolsets:',
          '  - hermes-cli',
          '  - web',
          'model:',
          '  provider: other',
          '  default: other-model',
          '  reasoning: high',
          'providers:',
          '  other:',
          '    name: Other',
          '    api: https://other.test/v1',
          '    api_key: other-key',
          'gateway:',
          '  enabled: true',
          '',
        ].join('\n'),
        'utf-8',
      );

      const generated = adapter.buildConfig(profileFor(openaiProvider), [openaiProvider]);
      await adapter.writeConfig(generated, 'global', undefined, true);

      const written = await adapter.readConfig('global');
      expect(written?._config_version).toBe(23);
      expect(written?.toolsets).toEqual(['hermes-cli', 'web']);
      expect(written?.gateway).toEqual({ enabled: true });
      expect(written?.model).toEqual({
        provider: 'agento-acme-cloud',
        default: 'acme-large',
        base_url: 'https://api.acme.test/v1',
        api_key: 'sk-acme',
        reasoning: 'high',
      });
      expect(Object.keys(written?.providers ?? {})).toEqual(['other', 'agento-acme-cloud']);
      expect(written?.providers?.other).toMatchObject({
        name: 'Other',
        api: 'https://other.test/v1',
      });
    });
  });

  it('writes exactly the given document when merge is disabled (restore path)', async () => {
    await withTempHome(async (home) => {
      const adapter = new HermesAdapter({ id: 'hermes', displayName: 'Hermes', home });
      const snapshot = { _config_version: 23, toolsets: ['hermes-cli'], model: { provider: 'x' } };

      await adapter.writeConfig(snapshot, 'project', undefined, false);

      await expect(adapter.readConfig('project')).resolves.toEqual(snapshot);
    });
  });

  it.runIf(process.platform !== 'win32')('writes config with owner-only permissions', async () => {
    await withTempHome(async (home) => {
      const adapter = new HermesAdapter({ id: 'hermes', displayName: 'Hermes', home });
      await adapter.writeConfig(
        adapter.buildConfig(profileFor(openaiProvider), [openaiProvider]),
        'global',
      );

      const file = adapter.configPaths().global;
      const mode = (await stat(file)).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(await readFile(file, 'utf-8')).toContain('providers:');
    });
  });
});

describe('mergeHermesConfig', () => {
  it('adds a provider without dropping the existing ones', () => {
    const merged = mergeHermesConfig(
      {
        providers: { a: { name: 'A', api: 'u', default_model: 'm', models: ['m'], api_key: 'k' } },
      },
      {
        providers: {
          b: { name: 'B', api: 'u2', default_model: 'm2', models: ['m2'], api_key: 'k2' },
        },
      },
    );

    expect(Object.keys(merged.providers ?? {})).toEqual(['a', 'b']);
  });
});
