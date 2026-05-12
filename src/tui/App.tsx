/**
 * Root TUI component. Manages screen routing between menu and sub-screens.
 */
import React, { useState } from 'react';
import { useApp } from 'ink';
import { MainMenu } from './screens/MainMenu.js';
import { LaunchAgent } from './screens/LaunchAgent.js';
import { Providers } from './screens/Providers.js';
import { Profiles } from './screens/Profiles.js';
import { Agents } from './screens/Agents.js';
import { Settings } from './screens/Settings.js';
import type { ExecRequest } from '../launcher/independent.js';

/** Available screens in the TUI. */
export type Screen = 'main' | 'launch' | 'providers' | 'profiles' | 'agents' | 'settings';

interface AppProps {
  dev?: boolean;
  onExec?: (req: ExecRequest) => void;
}

/** Root Ink component that switches between TUI screens. */
export function App({ dev, onExec }: AppProps): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('main');
  const { exit } = useApp();

  const navigate = (target: Screen): void => {
    setScreen(target);
  };

  const goBack = (): void => {
    setScreen('main');
  };

  const handleExec = (req: ExecRequest): void => {
    onExec?.(req);
    exit();
  };

  if (screen === 'main') {
    return <MainMenu onSelect={navigate} onExit={exit} />;
  }

  if (screen === 'launch') {
    return <LaunchAgent dev={dev} onBack={goBack} onExec={handleExec} />;
  }

  if (screen === 'providers') {
    return <Providers onBack={goBack} />;
  }

  if (screen === 'profiles') {
    return <Profiles onBack={goBack} />;
  }

  if (screen === 'agents') {
    return <Agents dev={dev} onBack={goBack} />;
  }

  if (screen === 'settings') {
    return <Settings onBack={goBack} />;
  }

  return <MainMenu onSelect={navigate} onExit={exit} />;
}
