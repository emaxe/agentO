import React from 'react';
import { Box, Text } from 'ink';
import { StatusLine } from '../components/StatusLine.js';
import type { Profile, Provider } from '../../config/schema.js';

interface ProfileDetailProps {
  profile: Profile;
  providers: Provider[];
  selectedModel: number;
  status?: string;
  onBack: () => void;
  onAddModel: () => void;
  onDeleteModel: () => void;
  onEdit: () => void;
}

export function ProfileDetail({
  profile,
  providers,
  selectedModel,
  status,
}: ProfileDetailProps): React.JSX.Element {
  const viewport = 12;
  const start = Math.max(
    0,
    Math.min(selectedModel - Math.floor(viewport / 2), profile.models.length - viewport),
  );
  const end = Math.min(profile.models.length, start + viewport);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{profile.name}</Text>
      <Text dimColor>↑↓ navigate | a: add | d: delete | e: edit | ? help | Esc back</Text>
      <StatusLine message={status ?? ''} />
      <Box flexDirection="column" marginTop={1}>
        {start > 0 && <Text dimColor> ↑ {start} more</Text>}
        {profile.models.slice(start, end).map((m, rel) => {
          const i = start + rel;
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
        {end < profile.models.length && <Text dimColor> ↓ {profile.models.length - end} more</Text>}
      </Box>
    </Box>
  );
}
