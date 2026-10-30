import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home = '';
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home,
}));

beforeEach(async () => {
  const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
  home = await mkdtemp(join(tmpdir(), 'agento-lock-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('config operation lock', () => {
  it('waits for a separate process before entering the critical section', async () => {
    const { withConfigOperation } = await import('./config-operation.js');
    const directory = join(home, '.agento', 'backups');
    const marker = join(home, 'state');
    await mkdir(directory, { recursive: true });
    const packagePath = createRequire(import.meta.url).resolve('proper-lockfile');
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const lockfile = require(process.argv[1]);
      const fs = require('node:fs/promises');
      (async () => {
        const release = await lockfile.lock(process.argv[2], { stale: 10000, update: 2000 });
        await fs.writeFile(process.argv[3], 'holding');
        process.stdout.write('ready');
        process.stdin.once('data', async () => {
          await fs.writeFile(process.argv[3], 'released');
          await release();
          process.exit(0);
        });
      })().catch(error => { console.error(error); process.exit(1); });
    `,
        packagePath,
        directory,
        marker,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const exited = once(child, 'exit');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        once(child.stdout, 'data'),
        exited.then(() => {
          throw new Error('Lock holder exited before acquiring the lock');
        }),
      ]);
      const operation = withConfigOperation(() => readFile(marker, 'utf8'));
      timer = setTimeout(() => child.stdin.write('release'), 100);
      expect(await operation).toBe('released');
      expect((await exited)[0]).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      child.kill();
      await exited;
    }
  });

  it('recovers a stale operation lock left by a crashed process', async () => {
    const { withConfigOperation } = await import('./config-operation.js');
    const directory = join(home, '.agento', 'backups');
    await mkdir(`${directory}.lock`, { recursive: true });
    const old = new Date(Date.now() - 30_000);
    await utimes(`${directory}.lock`, old, old);
    await expect(withConfigOperation(async () => 'recovered')).resolves.toBe('recovered');
  });

  it('releases the operation lock when an operation throws', async () => {
    const { withConfigOperation } = await import('./config-operation.js');
    await expect(
      withConfigOperation(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(withConfigOperation(async () => 'next')).resolves.toBe('next');
  });
});

describe('config file reservations', () => {
  async function reserve(agentId: string, files: unknown, extra: Record<string, unknown> = {}) {
    const directory = join(home, '.agento', 'backups', agentId, 'project', 'nested');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'project.bak.json');
    await writeFile(
      file,
      JSON.stringify({ version: 2, agentId, scope: 'project', files, ...extra }),
    );
    return file;
  }

  function request(path: string) {
    return [{ path, hadFile: false, content: null }];
  }

  it('allows a different config file even for the same agent', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    await reserve('qwen', [{ path: join(home, 'one', 'settings.json') }]);
    await expect(
      assertConfigFilesAvailable(request(join(home, 'two', 'settings.json')), 'qwen'),
    ).resolves.toBeUndefined();
  });

  it('blocks an overlapping file belonging to another agent and explains how to restore it', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const shared = join(home, 'settings.json');
    const cwd = join(home, 'project');
    const backup = await reserve('qwen', [{ path: shared }], { cwd });
    const result = assertConfigFilesAvailable(request(shared), 'other-agent');
    await expect(result).rejects.toThrow('agento restore -a qwen -s project');
    await expect(result).rejects.toThrow(cwd);
    await expect(result).rejects.toThrow(backup);
  });

  it('checks every file of a multi-file manifest', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const shared = join(home, 'second.json');
    await reserve('codex', [{ path: join(home, 'first.json') }, { path: shared }]);
    await expect(assertConfigFilesAvailable(request(shared), 'qwen')).rejects.toThrow(
      'shared config file',
    );
  });

  it('resolves a symlinked parent when the requested config does not exist yet', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const target = join(home, 'real');
    const alias = join(home, 'alias');
    await mkdir(target);
    await symlink(target, alias, 'junction');
    await reserve('qwen', [{ path: join(target, 'missing', 'settings.json') }]);
    await expect(
      assertConfigFilesAvailable(request(join(alias, 'missing', 'settings.json')), 'other-agent'),
    ).rejects.toThrow('shared config file');
  });

  it.each([undefined, null, {}, [null], [{ path: 123 }]])(
    'refuses malformed v2 file lists: %j',
    async (files) => {
      const { assertConfigFilesAvailable } = await import('./config-operation.js');
      await reserve('qwen', files);
      await expect(
        assertConfigFilesAvailable(request(join(home, 'settings.json')), 'other-agent'),
      ).rejects.toThrow('Invalid backup manifest');
    },
  );

  it('refuses invalid JSON without changing the backup', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const backup = await reserve('qwen', []);
    await writeFile(backup, '{broken');
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'other-agent'),
    ).rejects.toThrow();
    expect(await readFile(backup, 'utf8')).toBe('{broken');
  });

  it('reserves the agent for legacy backups that have no physical path', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const backup = await reserve('qwen', []);
    await writeFile(backup, JSON.stringify({ model: 'legacy-original' }));
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'qwen'),
    ).rejects.toThrow('Active backup already exists for qwen');
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'other-agent'),
    ).resolves.toBeUndefined();
  });

  it('reserves pathless v2 backups only for their owning agent', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    await reserve('qwen', [{ path: '' }]);
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'qwen'),
    ).rejects.toThrow('Active backup already exists');
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'other-agent'),
    ).resolves.toBeUndefined();
  });

  it('ignores temporary files and lock directories while scanning reservations', async () => {
    const { assertConfigFilesAvailable } = await import('./config-operation.js');
    const directory = join(home, '.agento', 'backups');
    await mkdir(join(directory, 'operation.lock'), { recursive: true });
    await writeFile(join(directory, 'unfinished.tmp'), '{');
    await writeFile(join(directory, 'operation.lock', 'global.bak.json'), '{');
    await expect(
      assertConfigFilesAvailable(request(join(home, 'settings.json')), 'qwen'),
    ).resolves.toBeUndefined();
  });
});

describe('canonicalConfigPath', () => {
  it('resolves existing parent directories and preserves the missing suffix', async () => {
    const { canonicalConfigPath } = await import('./config-operation.js');
    const expected = join(await realpath(home), 'missing', 'settings.json');
    expect(await canonicalConfigPath(join(home, 'missing', 'settings.json'), 'linux')).toBe(
      expected,
    );
  });

  it('folds case only on Windows', async () => {
    const { canonicalConfigPath } = await import('./config-operation.js');
    const file = join(home, 'Missing', 'Settings.json');
    const expected = join(await realpath(home), 'Missing', 'Settings.json');
    expect(await canonicalConfigPath(file, 'win32')).toBe(expected.toLowerCase());
    expect(await canonicalConfigPath(file, 'darwin')).toBe(expected);
  });
});
