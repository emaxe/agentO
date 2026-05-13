import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from './codex.js';

const adapter = new CodexAdapter();

describe('CodexAdapter file mode', () => {
  it('writeConfig sets 0o600 file mode on POSIX (TOML)', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'agento-codex-test-'));
    try {
      // Use model-only config to avoid writing to real homedir (no global-owned keys)
      const config = { model: 'test-model' };
      await adapter.writeConfig(config, 'project', dir);
      const filePath = join(dir, '.codex', 'config.toml');
      const info = await stat(filePath);
      // eslint-disable-next-line no-bitwise
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
