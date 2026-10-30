// Requires: npm run build
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'dist/bin/agento.js');

describe.skipIf(!existsSync(CLI))('CLI smoke (dist)', () => {
  it('--version outputs package version', () => {
    const result = spawnSync('node', [CLI, '--version'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help exits 0 and mentions agento', () => {
    const result = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('agento');
  });

  it('launch --help exits 0', () => {
    const result = spawnSync('node', [CLI, 'launch', '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('restore --help exits 0', () => {
    const result = spawnSync('node', [CLI, 'restore', '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('config path exits 0', () => {
    const result = spawnSync('node', [CLI, 'config', 'path'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('config.json');
  });

  it('doctor --help exits 0', () => {
    const result = spawnSync('node', [CLI, 'doctor', '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('refuses to start the TUI without a terminal', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf-8', stdio: 'pipe' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('the interactive TUI needs a terminal');
  });

  it('provider list --json flushes the whole document through a pipe', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agento-json-smoke-'));
    try {
      const providers = Array.from({ length: 300 }, (_, i) => ({
        id: randomUUID(),
        name: `Provider-${i}-${'x'.repeat(200)}`,
        type: 'openai-compatible',
        apiKey: `key-${i}`,
        baseUrl: 'https://example.test/v1',
        models: Array.from({ length: 10 }, (_, j) => ({
          name: `model-${i}-${j}-${'y'.repeat(50)}`,
          capabilities: { image: true, video: false, audio: false },
        })),
      }));
      await mkdir(join(home, '.agento'), { recursive: true });
      await writeFile(
        join(home, '.agento', 'config.json'),
        JSON.stringify({
          providers,
          profiles: [],
          settings: {
            defaultLaunchMode: 'child',
            defaultConfigScope: 'global',
            mergeAgentConfigs: true,
          },
        }),
      );

      const result = spawnSync(process.execPath, [CLI, 'provider', 'list', '--json'], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home },
        maxBuffer: 16 * 1024 * 1024,
      });

      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(64 * 1024);
      expect(JSON.parse(result.stdout)).toHaveLength(300);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
