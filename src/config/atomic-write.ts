import { writeFile, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * Error codes Windows raises while a file is momentarily held open — by an antivirus
 * scanner, the search indexer, or an agent that has not released its config yet.
 * They clear up on their own, so a short retry is the right answer there.
 */
const TRANSIENT_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Attempts on win32; POSIX makes a single attempt, as before. */
const WIN32_MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 25;
const BACKOFF_MAX_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `op`, retrying on transient Windows sharing errors with exponential backoff
 * (25 → 400 ms, roughly 1.5 s across all attempts). Anything else — including
 * `ENOENT` — and every error on POSIX is thrown on the first failure.
 */
async function withWindowsRetry<T>(op: () => Promise<T>, platform: NodeJS.Platform): Promise<T> {
  const maxAttempts = platform === 'win32' ? WIN32_MAX_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= maxAttempts || !TRANSIENT_FS_CODES.has(code)) throw err;
      await sleep(Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS));
    }
  }
}

/** `rename`, retried on win32 when the destination is briefly locked. */
export function renameWithRetry(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return withWindowsRetry(() => rename(from, to), platform);
}

/** `unlink`, retried on win32 when the file is briefly locked. */
export function unlinkWithRetry(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return withWindowsRetry(() => unlink(path), platform);
}

/**
 * Writes content atomically: to a temp file in the same directory,
 * sets the given file mode, then renames into place. Cleans up temp on error.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  const tmp = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, content, { encoding: 'utf-8', mode });
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Serializes data as JSON and writes atomically with writeFileAtomic.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  mode = 0o600,
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), mode);
}
