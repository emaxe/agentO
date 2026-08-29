/**
 * Keeps generated project-scope agent configs out of git.
 *
 * In `project` scope AgentO writes agent configs into the working directory
 * (`.claude/settings.json`, `.codex/config.toml`, …) and several adapters embed
 * the provider API key in them. Those paths are conventionally *tracked* files —
 * Claude Code, for instance, treats `.claude/settings.json` as the shared team
 * file and only gitignores `settings.local.json` — so a launch would otherwise
 * leave a secret staged for the next commit.
 *
 * We write to `.git/info/exclude` rather than the project's `.gitignore`:
 * `info/exclude` is local-only and never committed, so AgentO does not mutate a
 * file the user shares with their team.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Header written once above the block of AgentO-managed entries. */
const MARKER = '# agento: generated agent configs (may contain API keys)';

/**
 * Walks up from `startDir` looking for a `.git` entry.
 * Returns the repository root, or `null` when outside a git repository.
 */
export function findGitRoot(startDir: string): string | null {
  let current = resolve(startDir);

  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolves the git *common* directory for a repository root.
 *
 * `.git` is a directory in a normal clone, but a file containing `gitdir: <path>`
 * in a linked worktree or submodule. Linked worktrees keep `info/exclude` in the
 * shared common dir, which their `commondir` file points at.
 * Returns `null` when the pointer cannot be resolved.
 */
export function resolveGitCommonDir(gitRoot: string): string | null {
  const gitPath = join(gitRoot, '.git');
  if (!existsSync(gitPath)) return null;

  if (statSync(gitPath).isDirectory()) return gitPath;

  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf-8'));
  if (!pointer?.[1]) return null;

  const gitDir = resolve(gitRoot, pointer[1].trim());
  const commondir = join(gitDir, 'commondir');
  if (existsSync(commondir)) {
    return resolve(gitDir, readFileSync(commondir, 'utf-8').trim());
  }
  return gitDir;
}

/**
 * Converts an absolute path into a root-anchored git exclude pattern
 * (`/.claude/settings.json`), or `null` when the path is outside the repo.
 * Anchoring matters because `info/exclude` patterns are relative to the repo root.
 */
export function toExcludePattern(gitRoot: string, targetPath: string): string | null {
  const rel = relative(gitRoot, targetPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return `/${rel.split(/[\\/]/).join('/')}`;
}

export interface GitExcludeResult {
  /** Patterns newly appended to `.git/info/exclude` on this call. */
  added: string[];
  /** Why nothing was written, when `added` is empty and it was not a no-op. */
  error?: string;
}

/**
 * Adds the given absolute paths to the repository's `.git/info/exclude`.
 *
 * Paths outside the repository and patterns already present are skipped, so the
 * call is idempotent across launches. Never throws: a repository that cannot be
 * written to is reported through {@link GitExcludeResult.error} so the caller can
 * warn instead of failing the launch.
 */
export async function addToGitExclude(cwd: string, targetPaths: string[]): Promise<GitExcludeResult> {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return { added: [] };

  const patterns = [...new Set(
    targetPaths
      .map((path) => toExcludePattern(gitRoot, path))
      .filter((pattern): pattern is string => pattern !== null),
  )];
  if (patterns.length === 0) return { added: [] };

  const commonDir = resolveGitCommonDir(gitRoot);
  if (!commonDir) return { added: [], error: 'could not resolve the .git directory' };

  const excludePath = join(commonDir, 'info', 'exclude');

  try {
    let existing = '';
    if (existsSync(excludePath)) {
      existing = await readFile(excludePath, 'utf-8');
    }

    const present = new Set(existing.split('\n').map((line) => line.trim()));
    const missing = patterns.filter((pattern) => !present.has(pattern));
    if (missing.length === 0) return { added: [] };

    const block = [
      ...(present.has(MARKER) ? [] : [MARKER]),
      ...missing,
    ].join('\n');
    const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';

    await mkdir(dirname(excludePath), { recursive: true });
    await writeFile(excludePath, `${existing}${separator}${block}\n`, 'utf-8');

    return { added: missing };
  } catch (error) {
    return { added: [], error: error instanceof Error ? error.message : String(error) };
  }
}
