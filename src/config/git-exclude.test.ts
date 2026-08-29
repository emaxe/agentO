import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addToGitExclude, findGitRoot, resolveGitCommonDir, toExcludePattern } from './git-exclude.js';

let dir: string;

/** Creates a minimal repository layout: a `.git` directory with `info/`. */
async function makeRepo(root: string): Promise<void> {
  await mkdir(join(root, '.git', 'info'), { recursive: true });
}

async function readExclude(root: string): Promise<string> {
  return readFile(join(root, '.git', 'info', 'exclude'), 'utf-8');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agento-git-exclude-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('findGitRoot', () => {
  it('finds the root from a nested directory', async () => {
    await makeRepo(dir);
    const nested = join(dir, 'a', 'b');
    await mkdir(nested, { recursive: true });
    expect(findGitRoot(nested)).toBe(dir);
  });

  it('returns null outside a repository', async () => {
    const nested = join(dir, 'plain');
    await mkdir(nested, { recursive: true });
    expect(findGitRoot(nested)).toBeNull();
  });
});

describe('resolveGitCommonDir', () => {
  it('returns the .git directory of a normal clone', async () => {
    await makeRepo(dir);
    expect(resolveGitCommonDir(dir)).toBe(join(dir, '.git'));
  });

  it('follows a .git file to the common dir of a linked worktree', async () => {
    // Main repo with a linked worktree: .git is a file pointing at
    // <main>/.git/worktrees/wt, whose commondir points back at <main>/.git.
    const main = join(dir, 'main');
    const gitDir = join(main, '.git');
    const worktreeGitDir = join(gitDir, 'worktrees', 'wt');
    await mkdir(join(gitDir, 'info'), { recursive: true });
    await mkdir(worktreeGitDir, { recursive: true });
    await writeFile(join(worktreeGitDir, 'commondir'), '../..\n');

    const worktree = join(dir, 'wt');
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, '.git'), `gitdir: ${worktreeGitDir}\n`);

    expect(resolveGitCommonDir(worktree)).toBe(gitDir);
  });
});

describe('toExcludePattern', () => {
  it('anchors repo-relative paths at the root', () => {
    expect(toExcludePattern('/repo', '/repo/.claude/settings.json')).toBe('/.claude/settings.json');
  });

  it('returns null for paths outside the repo', () => {
    expect(toExcludePattern('/repo', '/home/user/.claude/settings.json')).toBeNull();
  });

  it('returns null for the repo root itself', () => {
    expect(toExcludePattern('/repo', '/repo')).toBeNull();
  });
});

describe('addToGitExclude', () => {
  it('appends in-repo paths and reports them', async () => {
    await makeRepo(dir);
    const result = await addToGitExclude(dir, [join(dir, '.claude', 'settings.json')]);

    expect(result.error).toBeUndefined();
    expect(result.added).toEqual(['/.claude/settings.json']);
    expect(await readExclude(dir)).toContain('/.claude/settings.json');
  });

  it('is idempotent across repeated launches', async () => {
    await makeRepo(dir);
    const target = join(dir, '.claude', 'settings.json');

    await addToGitExclude(dir, [target]);
    const second = await addToGitExclude(dir, [target]);

    expect(second.added).toEqual([]);
    const content = await readExclude(dir);
    expect(content.match(/\/\.claude\/settings\.json/g)).toHaveLength(1);
  });

  it('skips paths outside the repository', async () => {
    await makeRepo(dir);
    const result = await addToGitExclude(dir, [
      join(dir, '.codex', 'config.toml'),
      '/somewhere/else/.codex/config.toml',
    ]);

    expect(result.added).toEqual(['/.codex/config.toml']);
  });

  it('preserves existing exclude content and separates it with a newline', async () => {
    await makeRepo(dir);
    await writeFile(join(dir, '.git', 'info', 'exclude'), '*.log');

    await addToGitExclude(dir, [join(dir, '.claude', 'settings.json')]);

    const content = await readExclude(dir);
    expect(content.startsWith('*.log\n')).toBe(true);
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('/.claude/settings.json');
  });

  it('does nothing outside a git repository', async () => {
    const result = await addToGitExclude(dir, [join(dir, '.claude', 'settings.json')]);
    expect(result).toEqual({ added: [] });
  });
});
