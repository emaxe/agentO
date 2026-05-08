import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { MainMenu } from './screens/MainMenu.js';

export type Screen = 'main' | 'launch' | 'providers' | 'profiles' | 'agents' | 'settings';

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('main');
  const { exit } = useApp();

  const navigate = (target: Screen): void => {
    setScreen(target);
  };

  const goBack = (): void => {
    setScreen('main');
  };

  if (screen === 'main') {
    return <MainMenu onSelect={navigate} onExit={exit} />;
  }

  // Заглушки для остальных экранов — реализация в задачах #17-20
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{screen.charAt(0).toUpperCase() + screen.slice(1)}</Text>
      <Text dimColor>Press Esc to go back</Text>
    </Box>
  );
}
