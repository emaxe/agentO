/**
 * Regression test for the TUI Agents screen restore flow.
 *
 * The screen used to restore only the *primary* file of a backup manifest and
 * then delete the manifest. For multi-file backups (Codex project scope) that
 * left the remaining files patched with no backup behind. The screen must
 * restore *every* file described by the manifest, exactly like `agento restore`.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';

let homeDir = '';
let projectDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => homeDir),
  };
});

function codexPaths(): { global: string; project: string; defaultProfile: string } {
  return {
    global: join(homeDir, '.codex', 'config.toml'),
    project: join(projectDir, '.codex', 'config.toml'),
    defaultProfile: join(homeDir, '.codex', 'default.config.toml'),
  };
}

async function writeToml(path: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyToml(config as Parameters<typeof stringifyToml>[0]), 'utf-8');
}

async function readToml(path: string): Promise<Record<string, unknown>> {
  return parseToml(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  needle: string,
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (frame.includes(needle)) return frame;
    if (Date.now() > deadline) {
      throw new Error(`Frame never contained "${needle}". Last frame:\n${frame}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * ink's input handling drops some of the rapid consecutive `stdin.write`
 * calls, so press Down and wait until the cursor actually moved, one step
 * at a time, until the requested row carries the `▶` marker.
 */
async function navigateToRow(
  stdin: { write: (data: string) => void },
  lastFrame: () => string | undefined,
  rowLabel: string,
): Promise<void> {
  const isThere = (): boolean =>
    (lastFrame() ?? '').split('\n').some((l) => l.includes('▶') && l.includes(rowLabel));
  for (let guard = 0; guard < 30 && !isThere(); guard++) {
    stdin.write('\u001B[B');
    const deadline = Date.now() + 300;
    while (Date.now() < deadline && !isThere()) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  if (!isThere()) throw new Error(`Could not reach row "${rowLabel}"`);
  // The frame can paint before React's passive effects re-subscribe the fresh
  // input handler; let the re-subscription land before sending more keys.
  await new Promise((r) => setTimeout(r, 100));
}

describe('Agents screen restore', () => {
  beforeEach(async () => {
    vi.resetModules();
    homeDir = await mkdtemp(join(tmpdir(), 'agento-agents-home-'));
    projectDir = await mkdtemp(join(tmpdir(), 'agento-agents-project-'));
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('restores every file of a multi-file Codex project backup and clears the manifest', async () => {
    const paths = codexPaths();
    const originalGlobal = {
      theme: 'light',
      model_providers: { old: { name: 'Old', base_url: 'https://old.test/v1' } },
      default_profile: 'old',
      profiles: { old: { model: 'old-model', model_provider: 'old' } },
    };
    const originalProject = { model: 'old-project-model' };
    const originalProfile = { model: 'old-profile-model', model_provider: 'old' };

    const { writeBackup, backupExists } = await import('../../config/store.js');
    await writeBackup('codex', 'project', {
      cwd: projectDir,
      files: [
        { path: paths.global, format: 'toml', hadFile: true, content: originalGlobal },
        { path: paths.project, format: 'toml', hadFile: true, content: originalProject },
        { path: paths.defaultProfile, format: 'toml', hadFile: true, content: originalProfile },
      ],
    });
    await writeToml(paths.global, { theme: 'light', model_providers: { new: { name: 'New' } } });
    await writeToml(paths.project, { model: 'new-project-model' });
    await writeToml(paths.defaultProfile, { model: 'new-profile-model', model_provider: 'new' });

    const { Agents } = await import('./Agents.js');
    const { stdin, lastFrame } = render(<Agents dev onBack={() => {}} />);

    await navigateToRow(stdin, lastFrame, 'Codex CLI [project]');

    stdin.write('r');
    const frame = await waitForFrame(lastFrame, 'Restored');
    expect(frame).toContain('Codex');
    // The selected row must show which file it refers to — two "codex" rows
    // differ only by the config path.
    expect(frame).toContain(join('.codex', 'config.toml'));

    expect(await readToml(paths.global)).toEqual(originalGlobal);
    expect(await readToml(paths.project)).toEqual(originalProject);
    expect(await readToml(paths.defaultProfile)).toEqual(originalProfile);
    expect(backupExists('codex', 'project', projectDir)).toBe(false);
  });
});
