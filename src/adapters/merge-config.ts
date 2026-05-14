import type { AgentConfig } from './base.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Conservative shallow merge of agent configs.
 *
 * - Top-level keys present only in `existing` are preserved.
 * - Top-level keys from `generated` overwrite or add.
 * - Nested objects are replaced whole (no deep merge).
 * - Keys listed in `envKeys` receive a flat (shallow) merge instead of replacement.
 */
export function mergeAgentConfig<T extends AgentConfig>(
  existing: T,
  generated: T,
  envKeys: readonly string[],
): T {
  const result: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(generated)) {
    const genVal = generated[key];
    if (envKeys.includes(key) && isPlainObject(result[key]) && isPlainObject(genVal)) {
      result[key] = { ...result[key], ...genVal };
    } else {
      result[key] = genVal;
    }
  }
  return result as T;
}
