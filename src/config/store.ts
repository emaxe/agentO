import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AgentOConfigSchema, type AgentOConfig, type LaunchScope } from './schema.js';
import { unlinkWithRetry, writeJsonAtomic } from './atomic-write.js';

const CONFIG_DIR = join(homedir(), '.agento');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const BACKUPS_DIR = join(CONFIG_DIR, 'backups');
const AGENT_STATUS_PATH = join(CONFIG_DIR, 'agent-status.json');

function escapePathSegment(segment: string): string {
  return segment.replace(/[<>:"|?*]/g, '_');
}

/** Device names Windows refuses as file names, with or without an extension. */
const WIN32_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Longest backup key (joined segments) before the tail is replaced by a hash. */
const WIN32_MAX_KEY_LENGTH = 200;
const WIN32_HASH_LENGTH = 16;

/**
 * Windows backup key: case-insensitive (`C:\Proj` and `c:\proj` are one directory),
 * free of `:`, of reserved device names and of trailing dots/spaces (which Windows
 * silently strips, so two different cwds could otherwise collide), and bounded in
 * length. An over-long key keeps its leading segments and ends in a hash of the
 * whole path, so distinct deep directories stay distinct.
 */
function encodeWin32Cwd(cwd: string): string[] {
  const normalized = path.win32.normalize(cwd).toLowerCase();
  const segments = normalized
    .replace(/^\\\\\?\\/u, '')
    .replace(/^([a-z]):/u, '$1')
    .split(/[\\/]+/u)
    .map(escapePathSegment)
    .map((segment) => segment.replace(/[. ]+$/u, ''))
    .filter(Boolean)
    .map((segment) => (WIN32_RESERVED_NAMES.test(segment.split('.')[0]) ? `_${segment}` : segment));

  if (segments.join('/').length <= WIN32_MAX_KEY_LENGTH) return segments;

  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, WIN32_HASH_LENGTH);
  const kept: string[] = [];
  let length = WIN32_HASH_LENGTH;
  for (const segment of segments) {
    length += segment.length + 1;
    if (length > WIN32_MAX_KEY_LENGTH) break;
    kept.push(segment);
  }
  return [...kept, hash];
}

/**
 * Directory segments identifying a project cwd inside the backups tree.
 *
 * The POSIX layout is frozen: changing it would orphan the active backups of
 * users who already have one. Only the win32 branch is normalised.
 */
export function encodeCwdForBackup(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') return encodeWin32Cwd(cwd);
  const normalized = cwd.replace(/\\/g, '/');
  const withoutLeading = normalized.replace(/^\/+/u, '');
  return withoutLeading.split('/').filter(Boolean).map(escapePathSegment);
}

function getBackupDir(agentId: string, scope: LaunchScope, cwd?: string): string {
  if (scope === 'global' || !cwd) {
    return join(BACKUPS_DIR, agentId);
  }
  return join(BACKUPS_DIR, agentId, scope, ...encodeCwdForBackup(cwd));
}

function getLegacyBackupPath(agentId: string, scope: LaunchScope): string {
  return join(BACKUPS_DIR, agentId, `${scope}.bak.json`);
}

export type BackupFileFormat = 'json' | 'toml' | 'yaml' | 'raw' | 'none';

export interface BackupManifestFile {
  path: string;
  format: BackupFileFormat;
  hadFile: boolean;
  content: unknown;
}

export interface BackupManifest {
  version: 2;
  sessionId: string;
  agentId: string;
  scope: LaunchScope;
  cwd?: string;
  createdAt: string;
  /** Process that wrote the backup; lets a later launch tell a crashed session from a live one. */
  pid?: number;
  /** ISO start time of {@link pid}. Informational: pid liveness alone decides recovery. */
  pidStartedAt?: string;
  files: BackupManifestFile[];
}

export interface WriteBackupFile {
  path: string;
  format?: BackupFileFormat;
  hadFile: boolean;
  content: unknown;
}

export interface WriteBackupOptions {
  cwd?: string;
  files: WriteBackupFile[];
  sessionId?: string;
  createdAt?: string;
  /** Owner of the backup. Passed in rather than read from `process.pid` so tests control it. */
  pid?: number;
  pidStartedAt?: string;
}

const LEGACY_BACKUP_CREATED_AT = new Date(0).toISOString();
const BACKUP_FORMATS: BackupFileFormat[] = ['json', 'toml', 'yaml', 'raw', 'none'];

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

/**
 * Reads the AgentO config from disk.
 * The returned object is owned by the caller — do not mutate it directly.
 * Always produce a new config object and pass it to `writeConfig`.
 */
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
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(CONFIG_PATH, config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFormat(value: unknown): BackupFileFormat {
  return typeof value === 'string' && BACKUP_FORMATS.includes(value as BackupFileFormat)
    ? (value as BackupFileFormat)
    : 'json';
}

export function inferBackupFileFormat(path: string): BackupFileFormat {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.toml')) return 'toml';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  return 'raw';
}

function normalizeBackupManifest(
  raw: unknown,
  agentId: string,
  scope: LaunchScope,
): BackupManifest {
  if (isRecord(raw) && raw.version === 2 && Array.isArray(raw.files)) {
    const files = raw.files.filter(isRecord).map((file): BackupManifestFile => ({
      path: typeof file.path === 'string' ? file.path : '',
      format: normalizeFormat(file.format),
      hadFile: file.hadFile === true,
      content: file.content,
    }));

    return {
      version: 2,
      sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : 'unknown',
      agentId: typeof raw.agentId === 'string' ? raw.agentId : agentId,
      scope: raw.scope === 'project' ? 'project' : scope,
      cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : LEGACY_BACKUP_CREATED_AT,
      ...(typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0
        ? { pid: raw.pid }
        : {}),
      ...(typeof raw.pidStartedAt === 'string' ? { pidStartedAt: raw.pidStartedAt } : {}),
      files,
    };
  }

  return {
    version: 2,
    sessionId: 'legacy',
    agentId,
    scope,
    createdAt: LEGACY_BACKUP_CREATED_AT,
    files: [
      {
        path: '',
        format: 'json',
        hadFile: true,
        content: raw,
      },
    ],
  };
}

/** Сохраняет manifest-бэкап конфига агента. */
export async function writeBackup(
  agentId: string,
  scope: LaunchScope,
  options: WriteBackupOptions,
): Promise<void> {
  const dir = getBackupDir(agentId, scope, options.cwd);
  const backupPath = join(dir, `${scope}.bak.json`);
  if (existsSync(backupPath)) {
    throw new Error(
      `Active backup already exists for ${agentId} (${scope}). Run "agento restore -a ${agentId} -s ${scope}" before launching again.`,
    );
  }

  // Backward-compatibility: block if a legacy backup also exists for project scope
  if (scope === 'project' && options.cwd && existsSync(getLegacyBackupPath(agentId, scope))) {
    throw new Error(
      `Active backup already exists for ${agentId} (${scope}). Run "agento restore -a ${agentId} -s ${scope}" before launching again.`,
    );
  }

  const manifest: BackupManifest = {
    version: 2,
    sessionId: options.sessionId ?? randomUUID(),
    agentId,
    scope,
    cwd: options.cwd,
    createdAt: options.createdAt ?? new Date().toISOString(),
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
    ...(options.pidStartedAt !== undefined ? { pidStartedAt: options.pidStartedAt } : {}),
    files: options.files.map((file) => ({
      path: file.path,
      format: file.format ?? 'json',
      hadFile: file.hadFile,
      content: file.content,
    })),
  };

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(backupPath, manifest);
}

/** Читает бэкап конфига агента. Возвращает null если бэкап не существует. */
export async function readBackup(
  agentId: string,
  scope: LaunchScope,
  cwd?: string,
): Promise<BackupManifest | null> {
  const backupPath = join(getBackupDir(agentId, scope, cwd), `${scope}.bak.json`);
  if (existsSync(backupPath)) {
    const raw = await readFile(backupPath, 'utf-8');
    return normalizeBackupManifest(JSON.parse(raw) as unknown, agentId, scope);
  }

  // Backward-compatibility: fallback to legacy path for project scope
  if (scope === 'project' && cwd) {
    const legacyPath = getLegacyBackupPath(agentId, scope);
    if (existsSync(legacyPath)) {
      const raw = await readFile(legacyPath, 'utf-8');
      return normalizeBackupManifest(JSON.parse(raw) as unknown, agentId, scope);
    }
  }

  return null;
}

/** Проверяет существование бэкапа. */
export function backupExists(agentId: string, scope: string, cwd?: string): boolean {
  const backupPath = join(getBackupDir(agentId, scope as LaunchScope, cwd), `${scope}.bak.json`);
  if (existsSync(backupPath)) {
    return true;
  }

  // Backward-compatibility: fallback to legacy path for project scope
  if (scope === 'project' && cwd) {
    return existsSync(getLegacyBackupPath(agentId, scope as LaunchScope));
  }

  return false;
}

/** Удаляет бэкап конфига агента. Не бросает ошибку если файл не существует. */
export async function deleteBackup(agentId: string, scope: string, cwd?: string): Promise<void> {
  const backupPath = join(getBackupDir(agentId, scope as LaunchScope, cwd), `${scope}.bak.json`);
  try {
    await unlinkWithRetry(backupPath);
  } catch {
    /* file might not exist */
  }

  // Backward-compatibility: also try legacy path for project scope
  if (scope === 'project' && cwd) {
    try {
      await unlinkWithRetry(getLegacyBackupPath(agentId, scope as LaunchScope));
    } catch {
      /* file might not exist */
    }
  }
}

/** Возвращает путь к бэкапу. */
export function getBackupPath(agentId: string, scope: string, cwd?: string): string {
  return join(getBackupDir(agentId, scope as LaunchScope, cwd), `${scope}.bak.json`);
}

/** Install status of an agent as shown in the launch wizard. */
export interface AgentInstallStatus {
  installed: boolean;
  version?: string;
}

/** Reads cached agent install statuses from disk (legacy `boolean` values are normalized). */
export async function readAgentStatusCache(): Promise<Record<string, AgentInstallStatus>> {
  if (!existsSync(AGENT_STATUS_PATH)) return {};
  const raw = await readFile(AGENT_STATUS_PATH, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, AgentInstallStatus> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        out[id] = { installed: value };
      } else if (typeof value === 'object' && value !== null) {
        const v = value as { installed?: unknown; version?: unknown };
        if (typeof v.installed === 'boolean') {
          out[id] = {
            installed: v.installed,
            ...(typeof v.version === 'string' ? { version: v.version } : {}),
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Writes agent install statuses cache to disk. */
export async function writeAgentStatusCache(
  statuses: Record<string, AgentInstallStatus>,
): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(AGENT_STATUS_PATH, statuses);
}
