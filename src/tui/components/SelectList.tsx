import React from 'react';
import { Box, Text } from 'ink';
import { useViewport } from '../use-terminal-size.js';

export interface SelectListProps<T> {
  items: readonly T[];
  selected: number;
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  title?: string;
  hint?: string;
  emptyMessage?: string;
  /** Rows rendered at once; the window follows the cursor. */
  maxVisible?: number;
}

export function SelectList<T>({
  items,
  selected,
  renderItem,
  title,
  hint,
  emptyMessage = 'No items available',
  maxVisible: requestedVisible,
}: SelectListProps<T>): React.JSX.Element {
  const available = useViewport();
  const maxVisible = Math.min(requestedVisible ?? available, available);
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(maxVisible / 2), items.length - maxVisible),
  );
  const end = Math.min(items.length, start + maxVisible);
  const visible = items.slice(start, end);

  return (
    <Box flexDirection="column" padding={1}>
      {title && <Text bold>{title}</Text>}
      {hint && <Text dimColor>{hint}</Text>}
      <Box flexDirection="column" marginTop={title || hint ? 1 : 0}>
        {start > 0 && <Text dimColor> ↑ {start} more</Text>}
        {visible.map((item, i) => {
          const index = start + i;
          return (
            <Box key={index} flexDirection="column">
              {renderItem(item, index, index === selected)}
            </Box>
          );
        })}
        {end < items.length && <Text dimColor> ↓ {items.length - end} more</Text>}
        {items.length === 0 && <Text dimColor>{emptyMessage}</Text>}
      </Box>
    </Box>
  );
}
