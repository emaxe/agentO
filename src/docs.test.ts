/**
 * Guards the README tables against drifting from the code.
 *
 * Both READMEs list, per agent, which provider types it accepts — and that list
 * silently went stale once already: `anthropic` was renamed to
 * `anthropic-compatible` and `custom-api` was added, but the docs kept
 * advertising a type that no longer exists. These tests re-derive the tables
 * from the registry and the schema so the next rename fails here instead of in
 * a user's terminal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAgents } from './agents/registry.js';
import { PROVIDER_TYPES } from './config/schema.js';

const READMES = ['README.md', 'README.ru.md'] as const;
const agents = listAgents({ dev: true });

function read(name: string): string {
  return readFileSync(join(process.cwd(), name), 'utf-8');
}

/** Pulls the backticked tokens out of a markdown table cell. */
function tokens(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
}

/**
 * Finds the agent-table row whose command cell is `` `<command>` `` and returns
 * its "supported providers" column.
 */
function providerCellFor(markdown: string, command: string): string | undefined {
  const row = markdown
    .split('\n')
    .find((line) => line.startsWith('| [') && line.includes(`| \`${command}\` |`));
  return row?.split(' | ')[3];
}

describe.each(READMES)('%s agent table', (name) => {
  const markdown = read(name);

  it.each(agents.map((a) => [a.id, a.command] as const))(
    'lists the real provider types for %s',
    (id, command) => {
      const cell = providerCellFor(markdown, command);
      expect(cell, `no table row for \`${command}\``).toBeDefined();

      const adapter = agents.find((a) => a.id === id)!.adapter;
      expect(tokens(cell!).sort()).toEqual([...adapter.supportedProviderTypes].sort());
    },
  );
});

describe.each(READMES)('%s provider-type table', (name) => {
  const markdown = read(name);

  /** Rows of the provider-type table: `| \`type\` | agent, agent | examples |`. */
  const rows = new Map(
    markdown
      .split('\n')
      .filter((line) => /^\| `[a-z-]+` \| [a-z-]+(, [a-z-]+)* \|/.test(line))
      .map((line) => {
        const cells = line.split(' | ');
        return [tokens(cells[0] as string)[0] as string, (cells[1] as string).split(', ')] as const;
      }),
  );

  it('documents every provider type exactly once', () => {
    expect([...rows.keys()].sort()).toEqual([...PROVIDER_TYPES].sort());
  });

  it.each([...PROVIDER_TYPES])('lists the agents that actually accept %s', (type) => {
    const expected = agents
      .filter((a) => (a.adapter.supportedProviderTypes as readonly string[]).includes(type))
      .map((a) => a.id);
    expect(rows.get(type)).toEqual(expected);
  });
});

describe.each(READMES)('%s prose provider-type lists', (name) => {
  const markdown = read(name);

  it('never mixes a real provider type with a name the schema does not define', () => {
    // Matches a comma-separated run of backticked tokens, e.g.
    // "supports `anthropic`, `fireworks`, `openrouter`". A run that contains at
    // least one real provider type is a provider-type list, so every token in it
    // must be one — which is exactly how the stale `anthropic` was spotted.
    // Runs with no provider type at all (such as the customApiModes trio
    // `openai` / `anthropic` / `responses`) are mode names and are left alone.
    const types = new Set<string>(PROVIDER_TYPES);
    const offenders: string[] = [];

    for (const match of markdown.matchAll(/`[a-z][a-z0-9-]*`(?:(?:,| and|, and|\/) `[a-z][a-z0-9-]*`)+/g)) {
      const run = tokens(match[0]);
      if (!run.some((t) => types.has(t))) continue;
      offenders.push(...run.filter((t) => !types.has(t)));
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
