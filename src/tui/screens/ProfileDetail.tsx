import React from 'react';
import { Box, Text } from 'ink';
import type { Profile, Provider } from '../../config/schema.js';

interface ProfileDetailProps {
  profile: Profile;
  providers: Provider[];
  selectedModel: number;
  onBack: () => void;
  onAddModel: () => void;
  onDeleteModel: () => void;
  onEdit: () => void;
}

export function ProfileDetail({
  profile,
  providers,
  selectedModel,
}: ProfileDetailProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{profile.name}</Text>
      <Text dimColor>↑↓ navigate | a: add | d: delete | e: edit | Esc back</Text>
      <Box flexDirection="column" marginTop={1}>
        {profile.models.map((m, i) => {
          const p = providers.find((pr) => pr.id === m.providerId);
          return (
            <Text key={i} color={i === selectedModel ? 'green' : undefined}>
              {i === selectedModel ? '▶ ' : '  '}
              {m.model}
              {m.tier ? ` [${m.tier}]` : ''} (provider:{' '}
              {p?.name ?? m.providerId.slice(0, 8) + '...'})
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
