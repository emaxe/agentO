import React from 'react';
import { Text } from 'ink';
import { SelectList } from '../components/SelectList.js';
import type { Profile } from '../../config/schema.js';

interface ProfileSelectProps {
  profiles: Profile[];
  selected: number;
  onSelect: (index: number) => void;
  onBack: () => void;
}

export function ProfileSelect({ profiles, selected }: ProfileSelectProps): React.JSX.Element {
  return (
    <SelectList
      items={profiles}
      selected={selected}
      title="Select Profile"
      hint="↑↓ navigate, Enter select, Esc back"
      emptyMessage="No profiles configured. Add one first."
      renderItem={(profile, index, isSelected) => (
        <Text color={isSelected ? 'green' : undefined}>
          {isSelected ? '▶ ' : '  '}
          {profile.name}
        </Text>
      )}
    />
  );
}
