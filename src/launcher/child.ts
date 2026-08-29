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
 * Запускает агент как дочерний процесс.
 * Перед запуском: backup → patch config.
 * После завершения: restore config.
 * SIGTERM/SIGINT: cleanup-хук восстанавливает конфиг.
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

    // 5. Регистрируем SIGTERM/SIGINT хуки — пробрасываем сигнал дочернему процессу
    const handleSignal = (signal: NodeJS.Signals): void => {
      child.kill(signal);
      cleanup().catch(console.error).finally(() => process.exit(1));
    };
    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);

    child.on('exit', (code) => {
      process.removeListener('SIGTERM', handleSignal);
      process.removeListener('SIGINT', handleSignal);
      cleanup()
        .catch(console.error)
        .finally(() => resolve(code ?? 0));
    });

    child.on('error', (err) => {
      process.removeListener('SIGTERM', handleSignal);
      process.removeListener('SIGINT', handleSignal);
      cleanup()
        .catch(console.error)
        .finally(() => {
          console.error(`Failed to launch ${execReq.command}:`, err.message);
          resolve(1);
        });
    });
  });
}
