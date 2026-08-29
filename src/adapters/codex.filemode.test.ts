import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from './codex.js';

const adapter = new CodexAdapter();

describe('CodexAdapter file mode', () => {
  it('writeConfig sets 0o600 file mode on POSIX for config.toml', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-codex-test-'));
    try {
      // Use model-only config to avoid writing to real homedir (no global-owned keys)
      const config = { model: 'test-model' };
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.codex', 'config.toml');
      const info = await stat(filePath);
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writeConfig sets 0o600 file mode on POSIX for default.config.toml', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-codex-test-'));
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = dir;
      const config = {
        model: 'test-model',
        model_providers: {
          'test-provider': {
            name: 'Test Provider',
            base_url: 'https://test.example.com/v1',
            env_key: 'CODEX_TEST_PROVIDER_API_KEY',
            wire_api: 'responses',
          },
        },
        profiles: {
          default: {
            model: 'test-model',
            model_provider: 'test-provider',
          },
        },
        default_profile: 'default',
      };
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.codex', 'default.config.toml');
      const info = await stat(filePath);
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
    }
  });
});
