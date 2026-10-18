import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { spawnCommand } from '../platform/spawn.js';
import { forwardSignals } from './signal-forwarding.js';
import { prepareLaunchTransaction, type ExecRequest } from './transaction.js';

export interface ChildLaunchOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
  /** Signal-handling flavour; defaults to `process.platform`. Exists for tests. */
  platform?: NodeJS.Platform;
  /** Clock for the Windows double-interrupt window; defaults to `Date.now`. Exists for tests. */
  now?: () => number;
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
 * Запускает агент как дочерний процесс.
 * Перед запуском: backup → patch config.
 * После завершения: restore config.
 * Сигналы: см. `forwardSignals`; конфиг восстанавливается после выхода агента.
 */
export async function launchChild(options: ChildLaunchOptions): Promise<number> {
  const { execReq, cleanup, warnings } = await prepareChild(options);
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }

  return new Promise<number>((resolve) => {
    const child = spawnCommand(execReq.command, execReq.args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      env: execReq.env,
    });

    // Forwarding only touches the process; the agent's `exit` event drives cleanup.
    const forwarding = forwardSignals(child, {
      ...(options.platform !== undefined ? { platform: options.platform } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    let settled = false;

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
      forwarding.dispose();
      cleanup().catch(console.error).finally(finalize);
    };

    child.on('exit', (code) => {
      settle(() => {
        if (forwarding.wasSignalled()) {
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
