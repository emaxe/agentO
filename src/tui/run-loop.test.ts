/**
 * The TUI ⇄ agent cycle, and specifically its failure paths.
 *
 * `cleanup()` restores the agent's config and clears its active backup. It used
 * to be skipped whenever the agent failed to start for any reason other than a
 * missing binary, which left the config patched and the backup active — the next
 * launch then refused with "Active backup already exists" until the user ran
 * `agento restore` by hand.
 */
import { describe, it, expect, vi } from 'vitest';
import { isEnoent, runTuiLoop } from './run-loop.js';
import type { ExecRequest } from '../launcher/independent.js';

function request(overrides: Partial<ExecRequest> = {}): ExecRequest {
  return {
    command: 'claude',
    args: [],
    env: {},
    cleanup: vi.fn().mockResolvedValue(undefined),
    agentId: 'claude-code',
    profileId: 'prof-1',
    ...overrides,
  };
}

function enoent(): NodeJS.ErrnoException {
  const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

/** startTui stub that yields the given requests in order, then `null`. */
function scriptedTui(...requests: (ExecRequest | null)[]) {
  const queue = [...requests];
  return vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? null));
}

describe('isEnoent', () => {
  it('recognises a spawn ENOENT', () => {
    expect(isEnoent(enoent())).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isEnoent(new Error('boom'))).toBe(false);
    expect(isEnoent('ENOENT')).toBe(false);
    expect(isEnoent(undefined)).toBe(false);
  });
});

describe('runTuiLoop', () => {
  it('does nothing when the user quits without launching', async () => {
    const startTui = scriptedTui(null);
    const spawnAgent = vi.fn();

    await runTuiLoop({ startTui, spawnAgent });

    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('spawns the agent and restores the config afterwards', async () => {
    const req = request();
    const spawnAgent = vi.fn().mockResolvedValue(0);

    await runTuiLoop({ startTui: scriptedTui(req), spawnAgent });

    expect(spawnAgent).toHaveBeenCalledWith('claude', [], {});
    expect(req.cleanup).toHaveBeenCalledTimes(1);
  });

  it('restores the config when the agent could not be started at all', async () => {
    const req = request();
    const boom = new Error('EACCES: permission denied');
    const spawnAgent = vi.fn().mockRejectedValue(boom);

    // The error still surfaces — it just no longer skips cleanup on its way out.
    await expect(runTuiLoop({ startTui: scriptedTui(req), spawnAgent })).rejects.toThrow('EACCES');
    expect(req.cleanup).toHaveBeenCalledTimes(1);
  });

  it('restores the config when the agent exits non-zero', async () => {
    const req = request();
    const spawnAgent = vi.fn().mockResolvedValue(1);

    await runTuiLoop({ startTui: scriptedTui(req), spawnAgent });

    expect(req.cleanup).toHaveBeenCalledTimes(1);
  });

  it('reopens the TUI with an error when the binary is missing', async () => {
    const req = request({ command: 'kimi', agentId: 'kimi' });
    const startTui = scriptedTui(req, null);
    const spawnAgent = vi.fn().mockRejectedValue(enoent());

    await runTuiLoop({ startTui, spawnAgent }, { dev: true });

    expect(req.cleanup).toHaveBeenCalledTimes(1);
    expect(startTui).toHaveBeenNthCalledWith(2, {
      dev: true,
      launchError: {
        agentId: 'kimi',
        profileId: 'prof-1',
        error: 'Command "kimi" not found',
      },
    });
  });

  it('falls back to the command name when the request carries no agent id', async () => {
    const req = request({ agentId: undefined });
    const startTui = scriptedTui(req, null);
    const spawnAgent = vi.fn().mockRejectedValue(enoent());

    await runTuiLoop({ startTui, spawnAgent });

    expect(startTui.mock.calls[1]?.[0].launchError.agentId).toBe('claude');
  });

  it('loops again when the request asks for a relaunch', async () => {
    const first = request({ relaunch: true });
    const second = request();
    const spawnAgent = vi.fn().mockResolvedValue(0);

    await runTuiLoop({ startTui: scriptedTui(first, second), spawnAgent });

    expect(spawnAgent).toHaveBeenCalledTimes(2);
    expect(first.cleanup).toHaveBeenCalledTimes(1);
    expect(second.cleanup).toHaveBeenCalledTimes(1);
  });

  it('prints launch warnings before handing over the terminal', async () => {
    const order: string[] = [];
    const req = request({ warnings: ['added to .git/info/exclude: /.claude/settings.json'] });
    const warn = vi.fn((m: string) => void order.push(`warn:${m}`));
    const spawnAgent = vi.fn().mockImplementation(() => {
      order.push('spawn');
      return Promise.resolve(0);
    });

    await runTuiLoop({ startTui: scriptedTui(req), spawnAgent, warn });

    expect(warn).toHaveBeenCalledWith('Warning: added to .git/info/exclude: /.claude/settings.json');
    expect(order).toEqual(['warn:Warning: added to .git/info/exclude: /.claude/settings.json', 'spawn']);
  });

  it('pauses stdin before every spawn', async () => {
    const beforeSpawn = vi.fn();
    const spawnAgent = vi.fn().mockResolvedValue(0);

    await runTuiLoop({
      startTui: scriptedTui(request({ relaunch: true }), request()),
      spawnAgent,
      beforeSpawn,
    });

    expect(beforeSpawn).toHaveBeenCalledTimes(2);
  });

  it('tolerates a request with no cleanup hook', async () => {
    const spawnAgent = vi.fn().mockResolvedValue(0);
    await expect(
      runTuiLoop({ startTui: scriptedTui(request({ cleanup: undefined })), spawnAgent }),
    ).resolves.toBeUndefined();
  });
});
