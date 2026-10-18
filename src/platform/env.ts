/**
 * Environment-variable helpers that respect the host platform's key semantics.
 *
 * Windows treats environment variable names case-insensitively (`Path` and `PATH`
 * are the same variable), but a plain JS object does not. Building an env object
 * with both spellings makes the OS pick one of them arbitrarily, so every write
 * to a well-known variable has to go through {@link setEnvCI}.
 */

type Env = Record<string, string | undefined>;

/** Keys of `env` equal to `name` ignoring case, exact match first. */
function matchingKeys(env: Env, name: string): string[] {
  const lower = name.toLowerCase();
  const keys = Object.keys(env).filter((key) => key.toLowerCase() === lower);
  return keys.sort((a, b) => Number(b === name) - Number(a === name));
}

/** Reads `name` from `env`; on win32 the lookup ignores case (`Path` finds `PATH`). */
export function getEnvCI(
  env: Env,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== 'win32') return env[name];
  const [key] = matchingKeys(env, name);
  return key === undefined ? undefined : env[key];
}

/**
 * Writes `name` into `env`. On win32 an existing spelling of the key is reused
 * and any other-case duplicates are removed, so exactly one key remains.
 */
export function setEnvCI(
  env: Env,
  name: string,
  value: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') {
    env[name] = value;
    return;
  }
  const [key = name, ...duplicates] = matchingKeys(env, name);
  for (const duplicate of duplicates) {
    delete env[duplicate];
  }
  env[key] = value;
}
