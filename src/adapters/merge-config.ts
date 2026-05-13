import type { AgentConfig } from './base.js';

/**
 * Conservative shallow merge of agent configs.
 *
 * - Top-level keys present only in `existing` are preserved.
 * - Top-level keys from `generated` overwrite or add.
 * - Nested objects are replaced whole (no deep merge).
 * - Keys listed in `envKeys` receive a flat (shallow) merge instead of replacement.
 */
export function mergeAgentConfig(
  existing: AgentConfig,
  generated: AgentConfig,
  envKeys: readonly string[],
): AgentConfig {
  const result: AgentConfig = { ...existing };

  for (const key of Object.keys(generated)) {
    const genVal = generated[key];
    if (
      envKeys.includes(key) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof genVal === 'object' &&
      genVal !== null &&
      !Array.isArray(genVal)
    ) {
      result[key] = {
        ...(result[key] as Record<string, unknown>),
        ...(genVal as Record<string, unknown>),
      };
    } else {
      result[key] = genVal;
    }
  }

  return result;
}
