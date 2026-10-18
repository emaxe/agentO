import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../platform/kill-tree.js', () => ({ killTree: vi.fn() }));

import { killTree } from '../platform/kill-tree.js';
import { forwardSignals, type SignalForwarding } from './signal-forwarding.js';

const mockKillTree = vi.mocked(killTree);
const ALL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const;

const child = { pid: 99, kill: vi.fn(() => true) };

function raise(signal: NodeJS.Signals): void {
  for (const listener of process.listeners(signal)) (listener as (s: string) => void)(signal);
}

describe('forwardSignals', () => {
  let active: SignalForwarding | undefined;
  let baseline: number[];

  beforeEach(() => {
    mockKillTree.mockClear();
    baseline = ALL_SIGNALS.map((signal) => process.listenerCount(signal));
  });

  afterEach(() => {
    active?.dispose();
    active = undefined;
    vi.useRealTimers();
  });

  const counts = () => ALL_SIGNALS.map((signal) => process.listenerCount(signal));

  it.each(['win32', 'linux'] as const)(
    'dispose() removes every handler on %s and is idempotent',
    (platform) => {
      active = forwardSignals(child, { platform });
      expect(counts()).not.toEqual(baseline);

      active.dispose();
      active.dispose();

      expect(counts()).toEqual(baseline);
    },
  );

  it('dispose() cancels the POSIX grace timer', () => {
    vi.useFakeTimers();
    active = forwardSignals(child, { platform: 'linux' });

    raise('SIGTERM');
    active.dispose();
    vi.advanceTimersByTime(60_000);

    expect(mockKillTree).toHaveBeenCalledTimes(1);
  });

  it('reports wasSignalled only after agento terminated the agent', () => {
    active = forwardSignals(child, { platform: 'win32', onFirstInterrupt: () => undefined });
    expect(active.wasSignalled()).toBe(false);

    raise('SIGINT');
    expect(active.wasSignalled()).toBe(false);

    raise('SIGINT');
    expect(active.wasSignalled()).toBe(true);
  });

  it('calls a custom onFirstInterrupt instead of printing', () => {
    const onFirstInterrupt = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    active = forwardSignals(child, { platform: 'win32', onFirstInterrupt });

    raise('SIGINT');

    expect(onFirstInterrupt).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('passes the platform through to killTree', () => {
    active = forwardSignals(child, { platform: 'linux' });

    raise('SIGINT');

    expect(mockKillTree).toHaveBeenCalledWith(child, 'SIGINT', 'linux');
  });

  it('ignores further SIGINTs once the tree has been force-killed on win32', () => {
    active = forwardSignals(child, { platform: 'win32', onFirstInterrupt: () => undefined });

    raise('SIGINT');
    raise('SIGINT');
    raise('SIGINT');
    raise('SIGBREAK');

    expect(mockKillTree).toHaveBeenCalledTimes(1);
  });
});
