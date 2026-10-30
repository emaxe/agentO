import React from 'react';
import { Box, Text } from 'ink';
import { SelectList } from '../components/SelectList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { Profile } from '../../config/schema.js';

interface ProfileListProps {
  profiles: Profile[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  onBack: () => void;
  status?: string;
  filter?: string;
  searchOpen?: boolean;
}

export function ProfileList({
  profiles,
  selected,
  status,
  filter = '',
  searchOpen = false,
}: ProfileListProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Profiles</Text>
      <Text dimColor>
        ↑↓ navigate | Enter: detail | a: add | d: delete | /: search | ? help | Esc: back
      </Text>
      <StatusLine message={status ?? ''} />
      {(searchOpen || filter) && (
        <Text color={searchOpen ? 'cyan' : undefined} dimColor={!searchOpen}>
          {searchOpen ? `Search: ${filter}▌` : `filter: "${filter}"`}
        </Text>
      )}
      <SelectList
        items={profiles}
        selected={selected}
        maxVisible={12}
        renderItem={(profile, index, isSelected) => (
          <Text color={isSelected ? 'green' : undefined}>
            {isSelected ? '▶ ' : '  '}
            {profile.name} ({profile.models.length} models)
          </Text>
        )}
        emptyMessage={filter ? `No profiles match "${filter}".` : "No profiles. Press 'a' to add."}
      />
    </Box>
  );
}
