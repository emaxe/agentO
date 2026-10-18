import type { spawnCommand, spawnCommandSync } from '../platform/spawn.js';

type ChildProcess = ReturnType<typeof spawnCommand>;
type SpawnSyncReturns<T> = Omit<
  ReturnType<typeof spawnCommandSync>,
  'stdout' | 'stderr' | 'output'
> & {
  stdout: T;
  stderr: T;
  output: Array<T | null>;
};

/** A fake child whose `exit` fires with `code`, after emitting `stderr` (if any). */
export function fakeChild(code: number, stderr = ''): ChildProcess {
  return {
    stderr: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr) cb(Buffer.from(stderr));
      },
    },
    on: (event: string, cb: (code: number) => void) => {
      if (event === 'exit') cb(code);
    },
  } as unknown as ChildProcess;
}

/** A fake child that fails to spawn. */
export function failingChild(error: Error): ChildProcess {
  return {
    stderr: { on: () => undefined },
    on: (event: string, cb: (err: Error) => void) => {
      if (event === 'error') cb(error);
    },
  } as unknown as ChildProcess;
}

/** A `spawnSync` result. */
export function syncResult(
  partial: Partial<SpawnSyncReturns<string>> & { error?: Error & { code?: string } },
): SpawnSyncReturns<string> {
  return {
    status: 0,
    signal: null,
    output: [],
    pid: 1,
    stdout: '',
    stderr: '',
    ...partial,
  } as SpawnSyncReturns<string>;
}

export function errnoError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
