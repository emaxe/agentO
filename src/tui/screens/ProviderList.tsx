import React from 'react';
import { Box, Text } from 'ink';
import type { Provider } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';

interface ProviderListProps {
  providers: Provider[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
  status?: string;
}

export function ProviderList({
  providers,
  selected,
  status,
}: ProviderListProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Providers</Text>
      <Text dimColor>↑↓ navigate | Enter/a: add | e: edit | d: delete | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {providers.map((p, i) => (
          <Box key={p.id} flexDirection="column">
            <Text color={i === selected ? 'green' : undefined}>
              {i === selected ? '▶ ' : '  '}
              {p.name} ({p.type})
            </Text>
            {i === selected && (
              <Box flexDirection="column" paddingLeft={3}>
                <Text dimColor>key: {p.apiKey.slice(0, 8)}...</Text>
                <Text dimColor>
                  models:{' '}
                  {p.models.map((m) => `${capabilityMarker(m.capabilities)} ${m.name}`).join(', ')}
                </Text>
                {p.baseUrl && <Text dimColor>url: {p.baseUrl}</Text>}
              </Box>
            )}
          </Box>
        ))}
        {providers.length === 0 && <Text dimColor>No providers. Press 'a' to add.</Text>}
        <Text color={selected === providers.length ? 'green' : 'cyan'}>
          {selected === providers.length ? '▶ ' : '  '}[+ Add provider]
        </Text>
      </Box>
    </Box>
  );
}
