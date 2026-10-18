import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnCommand } from '../platform/spawn.js';
import { createNpmInstaller } from './npm.js';

vi.mock('../platform/spawn.js', () => ({
  spawnCommand: vi.fn(),
  spawnCommandSync: vi.fn(),
}));

describe('createNpmInstaller', () => {
  const installer = createNpmInstaller({
    agentId: 'claude-code',
    command: 'claude',
    packageName: '@anthropic-ai/claude-code',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('update', () => {
    it('calls npm update -g and resolves success on exit 0', async () => {
      const mockChild = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(0);
        }),
      };
      vi.mocked(spawnCommand).mockReturnValue(
        mockChild as unknown as ReturnType<typeof spawnCommand>,
      );

      const result = await installer.update();
      expect(result.success).toBe(true);
      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['update', '-g', '@anthropic-ai/claude-code'],
        {
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
        },
      );
    });

    it('resolves failure on non-zero exit', async () => {
      const mockChild = {
        stderr: {
          on: vi.fn((event: string, cb: (chunk: Buffer) => void) => cb(Buffer.from('npm err'))),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(1);
        }),
      };
      vi.mocked(spawnCommand).mockReturnValue(
        mockChild as unknown as ReturnType<typeof spawnCommand>,
      );

      const result = await installer.update();
      expect(result.success).toBe(false);
      expect(result.error).toContain('npm err');
    });
  });

  describe('uninstall', () => {
    it('calls npm uninstall -g and resolves success on exit 0', async () => {
      const mockChild = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(0);
        }),
      };
      vi.mocked(spawnCommand).mockReturnValue(
        mockChild as unknown as ReturnType<typeof spawnCommand>,
      );

      const result = await installer.uninstall();
      expect(result.success).toBe(true);
      expect(spawnCommand).toHaveBeenCalledWith(
        'npm',
        ['uninstall', '-g', '@anthropic-ai/claude-code'],
        {
          stdio: ['ignore', 'inherit', 'pipe'],
          shell: false,
        },
      );
    });

    it('resolves failure on non-zero exit', async () => {
      const mockChild = {
        stderr: {
          on: vi.fn((event: string, cb: (chunk: Buffer) => void) => cb(Buffer.from('npm err'))),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'exit') cb(1);
        }),
      };
      vi.mocked(spawnCommand).mockReturnValue(
        mockChild as unknown as ReturnType<typeof spawnCommand>,
      );

      const result = await installer.uninstall();
      expect(result.success).toBe(false);
      expect(result.error).toContain('npm err');
    });
  });
});
