import React, { useState } from 'react';
import { useApp } from 'ink';
import { MainMenu } from './screens/MainMenu.js';
import { LaunchAgent } from './screens/LaunchAgent.js';
import { Providers } from './screens/Providers.js';
import { Profiles } from './screens/Profiles.js';
import { Agents } from './screens/Agents.js';
import { Settings } from './screens/Settings.js';

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

  if (screen === 'launch') {
    return <LaunchAgent onBack={goBack} />;
  }

  if (screen === 'providers') {
    return <Providers onBack={goBack} />;
  }

  if (screen === 'profiles') {
    return <Profiles onBack={goBack} />;
  }

  if (screen === 'agents') {
    return <Agents onBack={goBack} />;
  }

  if (screen === 'settings') {
    return <Settings onBack={goBack} />;
  }

  return <MainMenu onSelect={navigate} onExit={exit} />;
}
