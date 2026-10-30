import React from 'react';
import { Box, Text } from 'ink';
import type { Provider } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';
import { maskSecret } from '../../config/mask.js';
import { StatusLine } from '../components/StatusLine.js';

export interface ProviderTestStatus {
  state: 'testing' | 'ok' | 'error';
  message: string;
}

interface ProviderListProps {
  providers: Provider[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
  status?: string;
  filter?: string;
  searchOpen?: boolean;
  testStatus?: Record<string, ProviderTestStatus>;
}

/** Rows visible at once; the window follows the cursor. */
const VIEWPORT = 10;

export function ProviderList({
  providers,
  selected,
  status,
  filter = '',
  searchOpen = false,
  testStatus = {},
}: ProviderListProps): React.JSX.Element {
  const anchor = Math.min(selected, Math.max(0, providers.length - 1));
  const start = Math.max(
    0,
    Math.min(anchor - Math.floor(VIEWPORT / 2), providers.length - VIEWPORT),
  );
  const end = Math.min(providers.length, start + VIEWPORT);
  const visible = providers.slice(start, end);
  const test = providers[selected] ? testStatus[providers[selected]!.id] : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Providers</Text>
      <Text dimColor>
        ↑↓ navigate | Enter/e: edit | a: add | d: delete | t: test | c: duplicate | /: search | ?
        help | Esc: back
      </Text>
      <StatusLine message={status ?? ''} />
      {(searchOpen || filter) && (
        <Text color={searchOpen ? 'cyan' : undefined} dimColor={!searchOpen}>
          {searchOpen ? `Search: ${filter}▌` : `filter: "${filter}"`}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {start > 0 && <Text dimColor> ↑ {start} more</Text>}
        {visible.map((p, rel) => {
          const i = start + rel;
          return (
            <Box key={p.id} flexDirection="column">
              <Text color={i === selected ? 'green' : undefined}>
                {i === selected ? '▶ ' : '  '}
                {p.name} ({p.type})
              </Text>
              {i === selected && (
                <Box flexDirection="column" paddingLeft={3}>
                  <Text dimColor>key: {maskSecret(p.apiKey)}</Text>
                  <Text dimColor>
                    models:{' '}
                    {p.models
                      .map((m) => `${capabilityMarker(m.capabilities)} ${m.name}`)
                      .join(', ')}
                  </Text>
                  {p.baseUrl && <Text dimColor>url: {p.baseUrl}</Text>}
                  {test && (
                    <Text
                      color={
                        test.state === 'error' ? 'red' : test.state === 'ok' ? 'green' : 'yellow'
                      }
                    >
                      test: {test.message}
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
        {end < providers.length && <Text dimColor> ↓ {providers.length - end} more</Text>}
        {providers.length === 0 && (
          <Text dimColor>
            {filter ? `No providers match "${filter}".` : "No providers. Press 'a' to add."}
          </Text>
        )}
        <Text color={selected === providers.length ? 'green' : 'cyan'}>
          {selected === providers.length ? '▶ ' : '  '}[+ Add provider]
        </Text>
      </Box>
    </Box>
  );
}
