// Requires: npm run build
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

  it('refuses to start the TUI without a terminal', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf-8', stdio: 'pipe' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('the interactive TUI needs a terminal');
  });
});
