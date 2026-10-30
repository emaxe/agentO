import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonAtomicExclusive } from './atomic-write.js';

let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agento-exclusive-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('exclusive atomic JSON publication', () => {
  it('publishes complete JSON and removes the temporary file', async () => {
    const file = join(directory, 'backup.json');
    const data = { original: { model: 'keep-me' } };
    await writeJsonAtomicExclusive(file, data);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(data);
    expect(await readdir(directory)).toEqual(['backup.json']);
  });

  it('preserves an existing backup when publication is refused', async () => {
    const file = join(directory, 'backup.json');
    await writeJsonAtomicExclusive(file, { session: 'first' });
    await expect(writeJsonAtomicExclusive(file, { session: 'second' })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ session: 'first' });
    expect(await readdir(directory)).toEqual(['backup.json']);
  });

  it('allows exactly one concurrent writer without mixing their data', async () => {
    const file = join(directory, 'backup.json');
    const inputs = Array.from({ length: 8 }, (_, session) => ({
      session,
      content: String(session).repeat(20_000),
    }));
    const results = await Promise.allSettled(
      inputs.map((data) => writeJsonAtomicExclusive(file, data)),
    );
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'EEXIST' });
    }
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(inputs[winner]);
    expect(await readdir(directory)).toEqual(['backup.json']);
  });

  it('does not publish a file when serialization fails', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      writeJsonAtomicExclusive(join(directory, 'backup.json'), circular),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
