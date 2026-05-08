import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { writeBackup, readBackup } from '../config/store.js';

export interface ChildLaunchOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
}

/**
 * Запускает агент как дочерний процесс.
 * Перед запуском: backup → patch config.
 * После завершения: restore config.
 * SIGTERM/SIGINT: cleanup-хук восстанавливает конфиг.
 */
export async function launchChild(options: ChildLaunchOptions): Promise<number> {
  const { adapter, profile, providers, scope, command, args = [], cwd } = options;

  // 1. Backup текущего конфига агента
  const currentConfig = await adapter.readConfig(scope, cwd);
  await writeBackup(adapter.id, scope, currentConfig ?? {});

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Cleanup-функция: восстанавливает оригинальный конфиг
  const cleanup = async (): Promise<void> => {
    const backup = await readBackup(adapter.id, scope);
    if (backup !== null && Object.keys(backup as object).length > 0) {
      await adapter.writeConfig(backup as Record<string, unknown>, scope, cwd);
    }
  };

  // 4. Регистрируем SIGTERM/SIGINT хуки (REQ-13)
  const handleSignal = (): void => {
    cleanup().catch(console.error).finally(() => process.exit(1));
  };
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);

  // 5. Запускаем дочерний процесс
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: cwd ?? process.cwd(),
      shell: false,
    });

    child.on('exit', (code) => {
      // Убираем обработчики сигналов
      process.removeListener('SIGTERM', handleSignal);
      process.removeListener('SIGINT', handleSignal);

      // Restore конфига и возвращаем exit code
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
          console.error(`Failed to launch ${command}:`, err.message);
          resolve(1);
        });
    });
  });
}
