/**
 * Small, non-critical UI state that should survive an agent launch.
 *
 * Kept separate from `~/.agento/config.json`: this file is a convenience cache
 * (last profile/agent/mode/scope) and may be deleted at any time without
 * losing providers or profiles. Reads are intentionally tolerant — a corrupt
 * cache must never stop the TUI from opening.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';
import {
  AgentIdSchema,
  LaunchModeSchema,
  LaunchScopeSchema,
  type AgentId,
  type LaunchMode,
  type LaunchScope,
} from './schema.js';

export interface LastLaunch {
  profileId: string;
  agentId: AgentId;
  mode: LaunchMode;
  scope: LaunchScope;
}

export interface UiState {
  lastLaunch?: LastLaunch;
  confirmedLaunch?: { version: 1; fingerprint: string };
}

function uiStatePath(): string {
  return join(homedir(), '.agento', 'ui-state.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses untrusted JSON into a {@link UiState}, dropping anything unknown. */
export function parseUiState(raw: unknown): UiState {
  if (!isRecord(raw) || !isRecord(raw.lastLaunch)) return {};
  const last = raw.lastLaunch;
  const agent = AgentIdSchema.safeParse(last.agentId);
  const mode = LaunchModeSchema.safeParse(last.mode);
  const scope = LaunchScopeSchema.safeParse(last.scope);
  if (
    typeof last.profileId !== 'string' ||
    !last.profileId ||
    !agent.success ||
    !mode.success ||
    !scope.success
  ) {
    return {};
  }
  const confirmation =
    isRecord(raw.confirmedLaunch) &&
    raw.confirmedLaunch.version === 1 &&
    typeof raw.confirmedLaunch.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(raw.confirmedLaunch.fingerprint)
      ? { confirmedLaunch: { version: 1 as const, fingerprint: raw.confirmedLaunch.fingerprint } }
      : {};
  return {
    ...confirmation,
    lastLaunch: {
      profileId: last.profileId,
      agentId: agent.data,
      mode: mode.data,
      scope: scope.data,
    },
  };
}

/** Reads the UI cache; a missing or malformed file is an empty state, not an error. */
export async function readUiState(): Promise<UiState> {
  const path = uiStatePath();
  if (!existsSync(path)) return {};
  try {
    return parseUiState(JSON.parse(await readFile(path, 'utf-8')) as unknown);
  } catch {
    return {};
  }
}

/** Records the launch the user just started, preserving any other UI state. */
export async function writeLastLaunch(lastLaunch: LastLaunch, fingerprint?: string): Promise<void> {
  const current = await readUiState();
  const next: UiState = {
    ...current,
    lastLaunch,
    ...(fingerprint ? { confirmedLaunch: { version: 1 as const, fingerprint } } : {}),
  };
  await mkdir(join(homedir(), '.agento'), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(uiStatePath(), next);
}
