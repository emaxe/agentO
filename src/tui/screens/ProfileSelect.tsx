import React from 'react';
import { Box, Text } from 'ink';
import { SelectList } from '../components/SelectList.js';
import type { Profile, Provider } from '../../config/schema.js';

interface ProfileSelectProps {
  profiles: Profile[];
  providers?: Provider[];
  query?: string;
  searchOpen?: boolean;
  selected: number;
  onSelect: (index: number) => void;
  onBack: () => void;
}
export function ProfileSelect({
  profiles,
  providers = [],
  selected,
  query = '',
  searchOpen,
}: ProfileSelectProps) {
  return (
    <Box flexDirection="column">
      {(searchOpen || query) && (
        <Text color="cyan">
          Search: {query}
          {searchOpen ? '▌' : ''}
        </Text>
      )}
      <SelectList
        items={profiles}
        selected={selected}
        title="Select Profile"
        hint="↑↓ choose | Enter continue | / search | m mode | s scope | ? help | Esc back"
        emptyMessage={
          query ? 'No matching profiles.' : 'No profiles configured. Set up AgentO to continue.'
        }
        renderItem={(profile, i, isSelected) => {
          const model = profile.models.find((m) => m.tier === 'base') ?? profile.models[0];
          return (
            <Text color={isSelected ? 'green' : undefined} wrap="truncate-end">
              {isSelected ? '▶ ' : '  '}
              {profile.name} · {model?.model} (
              {providers.find((p) => p.id === model?.providerId)?.name ?? '?'})
            </Text>
          );
        }}
      />
    </Box>
  );
}
