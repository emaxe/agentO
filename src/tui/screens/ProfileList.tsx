import React from 'react';
import { Box, Text } from 'ink';
import { SelectList } from '../components/SelectList.js';
import type { Profile } from '../../config/schema.js';

interface ProfileListProps {
  profiles: Profile[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  onBack: () => void;
  status?: string;
}

export function ProfileList({ profiles, selected, status }: ProfileListProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Profiles</Text>
      <Text dimColor>↑↓ navigate | Enter: detail | a: add | d: delete | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <SelectList
        items={profiles}
        selected={selected}
        renderItem={(profile, index, isSelected) => (
          <Text color={isSelected ? 'green' : undefined}>
            {isSelected ? '▶ ' : '  '}
            {profile.name} ({profile.models.length} models)
          </Text>
        )}
        emptyMessage="No profiles. Press 'a' to add."
      />
    </Box>
  );
}
