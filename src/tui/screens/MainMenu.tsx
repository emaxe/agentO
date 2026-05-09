import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import type { Screen } from '../App.js';

const MENU_ITEMS: Array<{ label: string; screen: Screen }> = [
  { label: 'Launch Agent', screen: 'launch' },
  { label: 'Providers', screen: 'providers' },
  { label: 'Profiles', screen: 'profiles' },
  { label: 'Agents', screen: 'agents' },
  { label: 'Settings', screen: 'settings' },
];

interface MainMenuProps {
  onSelect: (screen: Screen) => void;
  onExit: () => void;
}

export function MainMenu({ onSelect, onExit }: MainMenuProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(MENU_ITEMS.length - 1, i + 1));
    } else if (key.return) {
      const item = MENU_ITEMS[selectedIndex];
      if (item) onSelect(item.screen);
    } else if (input === 'q' || key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1} width={40}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>AgentO</Text>
        <Text dimColor>v0.1.0</Text>
      </Box>
      <Box flexDirection="column">
        {MENU_ITEMS.map((item, i) => (
          <Text key={item.screen} color={i === selectedIndex ? 'green' : undefined}>
            {i === selectedIndex ? '▶  ' : '   '}
            {item.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
