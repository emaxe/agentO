import React from 'react';
import { Box, Text } from 'ink';

export interface SelectListProps<T> {
  items: readonly T[];
  selected: number;
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  title?: string;
  hint?: string;
  emptyMessage?: string;
}

export function SelectList<T>({
  items,
  selected,
  renderItem,
  title,
  hint,
  emptyMessage = 'No items available',
}: SelectListProps<T>): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      {title && <Text bold>{title}</Text>}
      {hint && <Text dimColor>{hint}</Text>}
      <Box flexDirection="column" marginTop={title || hint ? 1 : 0}>
        {items.map((item, i) => (
          <Box key={i} flexDirection="column">
            {renderItem(item, i, i === selected)}
          </Box>
        ))}
        {items.length === 0 && <Text dimColor>{emptyMessage}</Text>}
      </Box>
    </Box>
  );
}
