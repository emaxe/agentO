import { spawn } from 'node:child_process';
import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { prepareLaunchTransaction, type ExecRequest } from './transaction.js';

export interface ChildLaunchOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
}

export interface ChildPrepareResult {
  execReq: ExecRequest;
  cleanup: () => Promise<void>;
  /** Non-fatal notices raised while preparing the launch, for the caller to print. */
  warnings: string[];
}

/**
 * Готовит конфиг для запуска агента из TUI (child mode).
 * Делает backup и записывает новый конфиг, но не запускает процесс.
 * Возвращает ExecRequest и cleanup-функцию для последующего вызова из agento.ts.
 */
export async function prepareChild(options: ChildLaunchOptions): Promise<ChildPrepareResult> {
  return prepareLaunchTransaction(options);
}

/**
 * How long to wait for the agent to exit after forwarding a signal, before
 * escalating to SIGKILL. Long enough for an agent to flush its own state, short
 * enough that a wedged agent does not hold the terminal hostage.
 */
const SIGNAL_EXIT_GRACE_MS = 5_000;

/**
 * Запускает агент как дочерний процесс.
 * Перед запуском: backup → patch config.
 * После завершения: restore config.
 * SIGTERM/SIGINT: сигнал пробрасывается агенту, конфиг восстанавливается после его выхода.
 */
export async function launchChild(options: ChildLaunchOptions): Promise<number> {
  const { execReq, cleanup, warnings } = await prepareChild(options);
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  return new Promise<number>((resolve) => {
    const child = spawn(execReq.command, execReq.args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      env: execReq.env,
    });

    let signalled = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    /**
     * Restores the agent config exactly once, then hands control back.
     *
     * Both the signal path and the exit path used to call `cleanup()`, so a
     * Ctrl-C restored the config while the agent was still running and free to
     * write to it — and then the agent's own exit event restored it a second
     * time. Everything funnels through here now, and only the first caller wins.
     */
    const settle = (finalize: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      process.removeListener('SIGTERM', handleSignal);
      process.removeListener('SIGINT', handleSignal);
      cleanup().catch(console.error).finally(finalize);
    };

    /**
     * Forwards the signal and waits — the agent's `exit` event drives cleanup.
     *
     * Listening with `on` rather than `once` so a second Ctrl-C from an
     * impatient user escalates to SIGKILL instead of killing agento outright and
     * leaving the agent config patched with an active backup behind it.
     */
    function handleSignal(signal: NodeJS.Signals): void {
      if (signalled) {
        child.kill('SIGKILL');
        return;
      }
      signalled = true;
      child.kill(signal);
      killTimer = setTimeout(() => child.kill('SIGKILL'), SIGNAL_EXIT_GRACE_MS);
      // Do not let the grace timer alone keep the event loop alive.
      killTimer.unref();
    }

    process.on('SIGTERM', handleSignal);
    process.on('SIGINT', handleSignal);

    child.on('exit', (code) => {
      settle(() => {
        if (signalled) {
          process.exit(1);
        }
        resolve(code ?? 0);
      });
    });

    child.on('error', (err) => {
      settle(() => {
        console.error(`Failed to launch ${execReq.command}:`, err.message);
        resolve(1);
      });
    });
  });
}
