import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveExecutable: vi.fn() }));
vi.mock('./resolve-executable.js', () => ({ resolveExecutable: mocks.resolveExecutable }));

import { spawnCommand, spawnCommandSync } from './spawn.js';

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform);
  mocks.resolveExecutable.mockReset();
});

function run(
  cmd: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(process.platform === 'win32')('spawn wrappers (POSIX)', () => {
  it('async: returns the exit code and output of the child', async () => {
    const result = await run(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ]);
    expect(result).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
    expect(mocks.resolveExecutable).not.toHaveBeenCalled();
  });

  it('sync: returns status and output', () => {
    const result = spawnCommandSync(
      process.execPath,
      ['-e', 'process.stdout.write("hi"); process.exit(2)'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('hi');
    expect(mocks.resolveExecutable).not.toHaveBeenCalled();
  });

  it('passes arguments with spaces and shell metacharacters literally', async () => {
    const args = ['a b', '&', 'x&y', '"q"', '%PATH%', '$HOME', '^', '|', '>out'];
    const result = await run(process.execPath, [
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ]);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  it('forwards env and cwd', async () => {
    const child = spawnCommandSync(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.AGENTO_T + "|" + process.cwd())'],
      { encoding: 'utf8', env: { AGENTO_T: 'v' }, cwd: '/' },
    );
    expect(child.stdout).toBe('v|/');
  });

  it('async: a missing command emits ENOENT', async () => {
    await expect(run('agento-definitely-missing-cmd', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('sync: a missing command reports ENOENT with null status', () => {
    const result = spawnCommandSync('agento-definitely-missing-cmd', [], { encoding: 'utf8' });
    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOENT');
    expect(result.status).toBeNull();
  });
});

describe('spawn wrappers (win32 branch, resolver mocked)', () => {
  it('async: emits ENOENT with the spawn message when the command is not resolved', async () => {
    setPlatform('win32');
    mocks.resolveExecutable.mockReturnValue(null);

    const child = spawnCommand('agent', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => child.on('error', resolve));

    expect(error.code).toBe('ENOENT');
    expect(error.message).toBe('spawn agent ENOENT');
    expect(child.stderr).not.toBeNull();
  });

  it('async: does not create pipes the caller did not ask for', async () => {
    setPlatform('win32');
    mocks.resolveExecutable.mockReturnValue(null);

    const child = spawnCommand('agent', [], { stdio: 'inherit' });
    await new Promise((resolve) => child.on('error', resolve));

    expect(child.stdout).toBeNull();
    expect(child.stderr).toBeNull();
  });

  it('async: resolves against opts.env, not process.env', async () => {
    setPlatform('win32');
    mocks.resolveExecutable.mockReturnValue(null);
    const env = { PATH: 'C:\\custom' };

    const child = spawnCommand('agent', [], { env, stdio: 'ignore' });
    await new Promise((resolve) => child.on('error', resolve));

    expect(mocks.resolveExecutable).toHaveBeenCalledWith('agent', env, 'win32');
  });

  it('sync: returns an ENOENT result shaped like spawnSync', () => {
    setPlatform('win32');
    mocks.resolveExecutable.mockReturnValue(null);

    const result = spawnCommandSync('agent', ['--version'], { encoding: 'utf8' });

    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOENT');
    expect(result.error?.message).toBe('spawn agent ENOENT');
    expect(result.status).toBeNull();
    expect(result.stdout).toBeNull();
  });
});
