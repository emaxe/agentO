/**
 * The TUI speaks English (see the note in use-key-input.ts: hotkey hints are
 * English because the ЙЦУКЕН mapping is transparent). Screens that grew in
 * Russian (ProviderForm, AgentInstall, AgentAction) made the UI half one
 * language, half the other — and the ru-to-en hotkey mapping can't be
 * documented consistently that way. This scan keeps every rendered string in
 * src/tui English; comments may stay in any language.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TUI_DIR = fileURLToPath(new URL('.', import.meta.url));
const CYRILLIC = /[\u0400-\u04FF]/;

/** The layout map itself is keyed by Russian letters — that is data, not UI. */
const ALLOWED = ['use-key-input.ts'];

/** Works with both POSIX and Windows path separators (CI runs on windows too). */
export function isExcluded(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? '';
  return ALLOWED.includes(name) || file.includes('.test.');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function offendingLines(file: string): string[] {
  const source = readFileSync(file, 'utf-8');
  const bad: string[] = [];
  let inBlockComment = false;
  source.split('\n').forEach((rawLine, i) => {
    let line = rawLine;
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // Strip trailing line comments (a '//' preceded by ':' is a URL scheme).
    line = line.replace(/(?<!:)\/\/.*$/g, '');
    if (CYRILLIC.test(line)) bad.push(`${relative(TUI_DIR, file)}:${i + 1}: ${rawLine.trim()}`);
  });
  return bad;
}

describe('TUI language', () => {
  it.each(sourceFiles(TUI_DIR).filter((f) => !isExcluded(f)))(
    'renders only English strings in %s',
    (file) => {
      expect(offendingLines(file)).toEqual([]);
    },
  );
});

describe('isExcluded', () => {
  it.each(['src/tui/use-key-input.ts', 'C:\\repo\\src\\tui\\use-key-input.ts'])(
    'excludes the layout map under any path separator: %s',
    (file) => {
      expect(isExcluded(file)).toBe(true);
    },
  );

  it('does not exclude ordinary screens', () => {
    expect(isExcluded('C:\\repo\\src\\tui\\screens\\MainMenu.tsx')).toBe(false);
  });
});
