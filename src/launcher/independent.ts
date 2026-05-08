import { spawn } from 'node:child_process';
import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { writeBackup } from '../config/store.js';

export interface IndependentLaunchOptions {
  adapter: AgentAdapter;
  profile: Profile;
  providers: Provider[];
  scope: LaunchScope;
  command: string;
  args?: string[];
  cwd?: string;
}

/**
 * Запускает агент как независимый detached-процесс.
 * AgentO завершается после запуска.
 * Конфиг остаётся изменённым — восстановление по команде пользователя (agento restore).
 */
export async function launchIndependent(options: IndependentLaunchOptions): Promise<void> {
  const { adapter, profile, providers, scope, command, args = [], cwd } = options;

  // 1. Backup текущего конфига агента
  const currentConfig = await adapter.readConfig(scope, cwd);
  await writeBackup(adapter.id, scope, currentConfig ?? {});

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Запускаем detached-процесс
  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    cwd: cwd ?? process.cwd(),
    shell: false,
  });

  // 4. Отсоединяем дочерний процесс от родительского
  child.unref();
}
