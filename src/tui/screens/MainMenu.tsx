/**
 * Main menu screen of the TUI.
 *
 * Displays a bordered list of menu items. Navigation with arrow keys,
 * selection with Enter, exit with `q` or Escape.
 */
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import type { Screen } from '../App.js';
import { VERSION } from '../../config/version.js';
import { tuiBorderStyle } from '../border-style.js';

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
  state?: MainMenuState;
}

export interface MainMenuState {
  providers: number;
  profiles: number;
  /** Present when ~/.agento/config.json could not be read. */
  error?: string;
  lastLaunch?: {
    profileName: string;
    agentLabel: string;
    mode: string;
    scope: string;
  };
}

/** Ink component for the main menu screen. */
export function MainMenu({ onSelect, onExit, state }: MainMenuProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const help = useHelp();
  const columns = process.stdout.columns ?? 80;
  const width = Math.min(56, Math.max(40, columns - 2));

  useKeyInput((input, key) => {
    if (help.handleKey(input, key)) return;
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(MENU_ITEMS.length - 1, i + 1));
    } else if (key.return) {
      const item = MENU_ITEMS[selectedIndex];
      if (item) onSelect(item.screen);
    } else if (input === 'q' || key.escape) {
      onExit();
    } else if (/^[1-9]$/.test(input)) {
      const idx = Number(input) - 1;
      const item = MENU_ITEMS[idx];
      if (item) {
        setSelectedIndex(idx);
        onSelect(item.screen);
      }
    }
  });

  if (help.open) {
    return <HelpOverlay topic="main" />;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={tuiBorderStyle()}
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>AgentO</Text>
        <Text dimColor>v{VERSION}</Text>
      </Box>
      {state?.error ? (
        <Box marginTop={1}>
          <Text color="red">Config error: {state.error}</Text>
        </Box>
      ) : (
        state && (
          <Text dimColor>
            Providers: {state.providers} · Profiles: {state.profiles}
          </Text>
        )
      )}
      <Box flexDirection="column">
        {MENU_ITEMS.map((item, i) => (
          <Text key={item.screen} color={i === selectedIndex ? 'green' : undefined}>
            {i === selectedIndex ? '▶' : `${i + 1}`}
            {'  '}
            {item.label}
          </Text>
        ))}
      </Box>
      {state && !state.error && state.profiles === 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">No profiles yet</Text>
          <Text dimColor>
            {state.providers === 0
              ? 'Start with Providers (2), then create a profile (3).'
              : 'Create a profile (3), then launch an agent (1).'}
          </Text>
        </Box>
      )}
      {state?.lastLaunch && (
        <Box marginTop={1}>
          <Text dimColor>
            Last: {state.lastLaunch.profileName} → {state.lastLaunch.agentLabel} (
            {state.lastLaunch.mode}, {state.lastLaunch.scope})
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate | Enter open | 1-5 jump | ? help | q/Esc quit</Text>
      </Box>
    </Box>
  );
}
