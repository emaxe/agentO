import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentOConfigSchema, type AgentOConfig } from './schema.js';

const CONFIG_DIR = join(homedir(), '.agento');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const BACKUPS_DIR = join(CONFIG_DIR, 'backups');
const AGENT_STATUS_PATH = join(CONFIG_DIR, 'agent-status.json');

/** Мигрирует старый формат models: string[] → ModelConfig[]. */
function migrateConfig(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.providers)) {
    obj.providers = (obj.providers as unknown[]).map((p: unknown) => {
      if (typeof p !== 'object' || p === null) return p;
      const provider = p as Record<string, unknown>;
      if (Array.isArray(provider.models)) {
        provider.models = (provider.models as unknown[]).map((m: unknown) => {
          if (typeof m === 'string') {
            return { name: m, capabilities: { image: true, video: false, audio: false } };
          }
          return m;
        });
      }
      return provider;
    });
  }
  return obj;
}

/** Читает конфиг AgentO. Если файл не существует, возвращает дефолтный конфиг. */
export async function readConfig(): Promise<AgentOConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return AgentOConfigSchema.parse({});
  }
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  const migrated = migrateConfig(JSON.parse(raw));
  return AgentOConfigSchema.parse(migrated);
}

/** Записывает конфиг AgentO, создаёт директорию при необходимости. */
export async function writeConfig(config: AgentOConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/** Сохраняет бэкап конфига агента.
 * @param agentId - id агента (например 'claude-code')
 * @param scope - 'global' или 'project'
 * @param content - содержимое конфига (JSON-объект)
 */
export async function writeBackup(
  agentId: string,
  scope: string,
  content: unknown,
): Promise<void> {
  const dir = join(BACKUPS_DIR, agentId);
  await mkdir(dir, { recursive: true });
  const backupPath = join(dir, `${scope}.bak.json`);
  await writeFile(backupPath, JSON.stringify(content, null, 2), 'utf-8');
}

/** Читает бэкап конфига агента. Возвращает null если бэкап не существует. */
export async function readBackup(
  agentId: string,
  scope: string,
): Promise<unknown | null> {
  const backupPath = join(BACKUPS_DIR, agentId, `${scope}.bak.json`);
  if (!existsSync(backupPath)) {
    return null;
  }
  const raw = await readFile(backupPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

/** Проверяет существование бэкапа. */
export function backupExists(agentId: string, scope: string): boolean {
  const backupPath = join(BACKUPS_DIR, agentId, `${scope}.bak.json`);
  return existsSync(backupPath);
}

/** Удаляет бэкап конфига агента. Не бросает ошибку если файл не существует. */
export async function deleteBackup(agentId: string, scope: string): Promise<void> {
  const backupPath = join(BACKUPS_DIR, agentId, `${scope}.bak.json`);
  try { await unlink(backupPath); } catch { /* file might not exist */ }
}

/** Возвращает путь к бэкапу. */
export function getBackupPath(agentId: string, scope: string): string {
  return join(BACKUPS_DIR, agentId, `${scope}.bak.json`);
}

/** Reads cached agent install statuses from disk. */
export async function readAgentStatusCache(): Promise<Record<string, boolean>> {
  if (!existsSync(AGENT_STATUS_PATH)) return {};
  const raw = await readFile(AGENT_STATUS_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Writes agent install statuses cache to disk. */
export async function writeAgentStatusCache(statuses: Record<string, boolean>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(AGENT_STATUS_PATH, JSON.stringify(statuses, null, 2), 'utf-8');
}
