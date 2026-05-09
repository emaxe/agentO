import type { AgentAdapter, LaunchScope } from '../adapters/base.js';
import type { Profile, Provider } from '../config/schema.js';
import { writeBackup } from '../config/store.js';
import { shellPathResolver } from './shell-path-resolver.js';

export interface ExecRequest {
  command: string;
  args: string[];
  env: Record<string, string>;
  relaunch?: boolean;
  cleanup?: () => Promise<void>;
}

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
 * Готовит конфиг для независимого запуска агента.
 * Записывает backup текущего конфига, генерирует и сохраняет новый,
 * резолвит PATH и возвращает ExecRequest для запуска в терминале.
 */
export async function launchIndependent(options: IndependentLaunchOptions): Promise<ExecRequest> {
  const { adapter, profile, providers, scope, command, args = [], cwd } = options;

  // 1. Backup текущего конфига агента
  const currentConfig = await adapter.readConfig(scope, cwd);
  await writeBackup(adapter.id, scope, currentConfig ?? {});

  // 2. Генерируем и записываем новый конфиг
  const newConfig = adapter.buildConfig(profile, providers);
  await adapter.writeConfig(newConfig, scope, cwd);

  // 3. Резолвим PATH чтобы найти исполняемый файл агента
  const resolvedPath = await shellPathResolver.resolve();

  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const adapterEnv = adapter.buildEnv?.(profile, providers) ?? {};

  return {
    command,
    args,
    env: { ...cleanEnv, PATH: resolvedPath, ...adapterEnv },
  };
}
