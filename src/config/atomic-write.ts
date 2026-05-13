import { writeFile, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

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
    await rename(tmp, filePath);
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
