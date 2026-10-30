import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let testDir = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(() => testDir) };
});

beforeEach(async () => {
  vi.resetModules();
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  testDir = await mkdtemp(join(tmpdir(), 'agento-ui-state-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function getState() {
  return import('./ui-state.js');
}

describe('ui state', () => {
  it('returns an empty state when the file does not exist', async () => {
    const { readUiState } = await getState();
    expect(await readUiState()).toEqual({});
  });

  it('round-trips the last launch', async () => {
    const { readUiState, writeLastLaunch } = await getState();
    await writeLastLaunch({
      profileId: '00000000-0000-0000-0000-000000000002',
      agentId: 'claude-code',
      mode: 'child',
      scope: 'global',
    });

    expect(await readUiState()).toEqual({
      lastLaunch: {
        profileId: '00000000-0000-0000-0000-000000000002',
        agentId: 'claude-code',
        mode: 'child',
        scope: 'global',
      },
    });

    const raw = JSON.parse(
      await readFile(join(testDir, '.agento', 'ui-state.json'), 'utf-8'),
    ) as unknown;
    expect(raw).toMatchObject({ lastLaunch: { agentId: 'claude-code' } });
  });

  it('ignores malformed or unknown data', async () => {
    const { readUiState } = await getState();
    await mkdir(join(testDir, '.agento'), { recursive: true });
    const path = join(testDir, '.agento', 'ui-state.json');

    await writeFile(path, '{not json', 'utf-8');
    expect(await readUiState()).toEqual({});

    await writeFile(path, JSON.stringify({ lastLaunch: { agentId: 'nope' } }), 'utf-8');
    expect(await readUiState()).toEqual({});
  });
});
