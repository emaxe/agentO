import { spawn } from 'node:child_process';
import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { restorePrimaryBackupFile } from '../config/backup-restore.js';
import { writeBackup, readBackup, deleteBackup, inferBackupFileFormat } from '../config/store.js';
import type { ExecRequest } from './independent.js';
import { shellPathResolver } from './shell-path-resolver.js';

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
}

async function backupCurrentConfig(
  adapter: AgentAdapter,
  scope: LaunchScope,
  cwd?: string,
): Promise<void> {
  const currentConfig = await adapter.readConfig(scope, cwd);
  const configPath = adapter.configPaths(cwd)[scope];
  await writeBackup(adapter.id, scope, {
    cwd,
    files: [{
      path: configPath,
      format: inferBackupFileFormat(configPath),
      hadFile: currentConfig !== null,
      content: currentConfig,
    }],
  });
}

function createCleanup(adapter: AgentAdapter, scope: LaunchScope, cwd?: string): () => Promise<void> {
  return async (): Promise<void> => {
    const backup = await readBackup(adapter.id, scope);
    if (backup !== null) {
      await restorePrimaryBackupFile(adapter, backup, scope, cwd);
    }
    await deleteBackup(adapter.id, scope);
  };
}

/**
 * Готовит конфиг для запуска агента из TUI (child mode).
 * Делает backup и записывает новый конфиг, но не запускает процесс.
 * Возвращает ExecRequest и cleanup-функцию для последующего вызова из agento.ts.
 */
export async function prepareChild(options: ChildLaunchOptions): Promise<ChildPrepareResult> {
  const { adapter, profile, providers, scope, command, args = [], cwd } = options;

  // 1. Backup текущего конфига агента
  await backupCurrentConfig(adapter, scope, cwd);

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Резолвим PATH чтобы найти исполняемый файл агента
  const resolvedPath = await shellPathResolver.resolve();

  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};

  // 4. Cleanup-функция: восстанавливает оригинальный конфиг или удаляет файл
  const cleanup = createCleanup(adapter, scope, cwd);

  return {
    execReq: { command, args, env: { ...cleanEnv, PATH: resolvedPath, ...adapterEnv }, agentId: adapter.id, profileId: profile.id },
    cleanup,
  };
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
  await backupCurrentConfig(adapter, scope, cwd);

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Cleanup-функция: восстанавливает оригинальный конфиг или удаляет файл
  const cleanup = createCleanup(adapter, scope, cwd);

  // 4. Запускаем дочерний процесс
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const resolvedPath = await shellPathResolver.resolve();
  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};
  const spawnEnv = { ...cleanEnv, PATH: resolvedPath, ...adapterEnv };

  return new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: cwd ?? process.cwd(),
      shell: false,
      env: spawnEnv,
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
          console.error(`Failed to launch ${command}:`, err.message);
          resolve(1);
        });
    });
  });
}
