import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveExecutable } from './resolve-executable.js';
import { spawnCommand } from './spawn.js';

/** Runs on windows-latest only: exercises the real cmd.exe / CreateProcess behaviour. */
describe.skipIf(process.platform !== 'win32')('spawn wrappers (Windows)', () => {
  let dir = '';
  let fakeAgent = '';

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'agento-win-'));
    // The space in the file name is deliberate: it is what breaks naive quoting.
    fakeAgent = path.join(dir, 'fake agent.cmd');
    await writeFile(fakeAgent, '@echo off\r\necho %*\r\nexit /b 7\r\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a .cmd with a space in its path, passes arguments literally and keeps the exit code', async () => {
    const child = spawnCommand(fakeAgent, ['a b', '&calc', '"q"'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk));

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    expect(code).toBe(7);
    expect(stdout).toContain('a b');
    expect(stdout).toContain('&calc');
    expect(stdout).toContain('q');
    // `&calc` must have been an argument, not a second command: cmd.exe would have
    // reported `calc` as unrecognised (or started it) had it been interpreted.
    expect(stderr).not.toMatch(/not recognized/i);
  });

  it('emits ENOENT for a command that does not exist', async () => {
    const child = spawnCommand('definitely-not-a-command-xyz', [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const error = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
      child.on('error', resolve);
      child.on('close', () => reject(new Error('expected an error event')));
    });

    expect(error.code).toBe('ENOENT');
  });

  it('resolves cmd to cmd.exe as a native executable', () => {
    const resolved = resolveExecutable('cmd', process.env, 'win32');

    expect(resolved?.kind).toBe('native');
    expect(resolved?.path.toLowerCase()).toMatch(/[\\/]cmd\.exe$/);
  });
});
