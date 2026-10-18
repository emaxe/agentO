import { killTree, type KillableProcess } from '../platform/kill-tree.js';

/**
 * How long to wait for the agent to exit after forwarding a signal, before
 * escalating to SIGKILL. Long enough for an agent to flush its own state, short
 * enough that a wedged agent does not hold the terminal hostage. POSIX only.
 */
export const SIGNAL_EXIT_GRACE_MS = 5_000;

/** Windows: a second Ctrl+C inside this window force-quits the agent. */
export const WIN32_DOUBLE_INTERRUPT_MS = 3_000;

const POSIX_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
const WIN32_SIGNALS = ['SIGINT', 'SIGBREAK', 'SIGHUP'] as const;

export interface ForwardSignalsOptions {
  /** Defaults to `process.platform`; injectable for tests. */
  platform?: NodeJS.Platform;
  /** Windows only: called for the first Ctrl+C, which is deliberately not acted on. */
  onFirstInterrupt?: () => void;
}

export interface SignalForwarding {
  /** Unsubscribes every signal handler and cancels pending timers. Safe to call twice. */
  dispose: () => void;
  /** True once agento itself terminated (or tried to terminate) the agent. */
  wasSignalled: () => boolean;
}

function announceFirstInterrupt(): void {
  console.error('Press Ctrl+C again to force quit.');
}

/**
 * Keeps agento alive and in charge while an agent runs, so the caller's config
 * cleanup still happens when the user interrupts.
 *
 * Without handlers Node's default action ends agento immediately — before the
 * patched agent config has been restored.
 *
 * POSIX: `SIGINT`/`SIGTERM` are forwarded to the agent; a second signal, or the
 * agent still running after {@link SIGNAL_EXIT_GRACE_MS}, escalates to SIGKILL.
 *
 * Windows has no forwardable signals. A console Ctrl+C reaches the agent on its
 * own (it shares our console), so the first one is left alone; a second within
 * {@link WIN32_DOUBLE_INTERRUPT_MS} kills the agent's process tree. `SIGBREAK`
 * and `SIGHUP` (window closed) kill it at once. No grace timer: there is no
 * graceful channel to wait on.
 *
 * Only the process is handled here. Restoring config is the caller's job, driven
 * by the agent's `exit` event.
 */
export function forwardSignals(
  child: KillableProcess,
  options: ForwardSignalsOptions = {},
): SignalForwarding {
  const platform = options.platform ?? process.platform;
  const isWin = platform === 'win32';
  const onFirstInterrupt = options.onFirstInterrupt ?? announceFirstInterrupt;

  let signalled = false;
  let disposed = false;
  let killTimer: NodeJS.Timeout | undefined;
  let lastInterruptAt: number | undefined;

  const forceKill = (): void => {
    signalled = true;
    killTree(child, 'force', platform);
  };

  /**
   * Listening with `on` rather than `once` so a second Ctrl-C from an
   * impatient user escalates instead of killing agento outright and leaving
   * the agent config patched with an active backup behind it.
   */
  function handleSignal(signal: NodeJS.Signals): void {
    if (isWin) {
      if (signal !== 'SIGINT') {
        if (!signalled) forceKill();
        return;
      }
      if (signalled) return;
      const now = Date.now();
      if (lastInterruptAt !== undefined && now - lastInterruptAt <= WIN32_DOUBLE_INTERRUPT_MS) {
        forceKill();
        return;
      }
      lastInterruptAt = now;
      onFirstInterrupt();
      return;
    }

    if (signalled) {
      killTree(child, 'force', platform);
      return;
    }
    signalled = true;
    killTree(child, signal, platform);
    killTimer = setTimeout(() => killTree(child, 'force', platform), SIGNAL_EXIT_GRACE_MS);
    // Do not let the grace timer alone keep the event loop alive.
    killTimer.unref();
  }

  const signals: readonly NodeJS.Signals[] = isWin ? WIN32_SIGNALS : POSIX_SIGNALS;
  for (const signal of signals) process.on(signal, handleSignal);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(killTimer);
      for (const signal of signals) process.removeListener(signal, handleSignal);
    },
    wasSignalled: () => signalled,
  };
}
