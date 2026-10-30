/**
 * Root TUI component. Manages screen routing between menu and sub-screens.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from 'ink';
import { MainMenu, type MainMenuState } from './screens/MainMenu.js';
import { LaunchAgent } from './screens/LaunchAgent.js';
import { Providers } from './screens/Providers.js';
import { Profiles } from './screens/Profiles.js';
import { Agents } from './screens/Agents.js';
import { Settings } from './screens/Settings.js';
import { readConfig } from '../config/store.js';
import { readUiState } from '../config/ui-state.js';
import { getAgent } from '../agents/registry.js';
import type { ExecRequest } from '../launcher/independent.js';
import type { AgentInstallStatus } from '../config/store.js';

/** Available screens in the TUI. */
export type Screen = 'main' | 'launch' | 'providers' | 'profiles' | 'agents' | 'settings';

interface AppProps {
  dev?: boolean;
  initialScreen?: Screen;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
}

/** Root Ink component that switches between TUI screens. */
export function App({
  dev,
  initialScreen = 'main',
  onExec,
  launchError,
  agentStatusCache,
}: AppProps): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [menuState, setMenuState] = useState<MainMenuState | undefined>();
  const { exit } = useApp();

  useEffect(() => {
    if (screen !== 'main') return;
    let cancelled = false;
    Promise.all([readConfig(), readUiState()])
      .then(([config, ui]) => {
        if (cancelled) return;
        const last = ui.lastLaunch;
        const profile = last
          ? config.profiles.find((candidate) => candidate.id === last.profileId)
          : undefined;
        const agent = last ? getAgent(last.agentId, { dev: true }) : undefined;
        setMenuState({
          providers: config.providers.length,
          profiles: config.profiles.length,
          ...(last && profile && agent
            ? {
                lastLaunch: {
                  profileName: profile.name,
                  agentLabel: agent.label,
                  mode: last.mode,
                  scope: last.scope,
                },
              }
            : {}),
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setMenuState({
            providers: 0,
            profiles: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [screen, dev]);

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
    return <MainMenu state={menuState} onSelect={navigate} onExit={exit} />;
  }

  if (screen === 'launch') {
    return (
      <LaunchAgent
        dev={dev}
        onBack={goBack}
        onNavigate={navigate}
        onExec={handleExec}
        launchError={launchError}
        agentStatusCache={agentStatusCache}
      />
    );
  }

  if (screen === 'providers') {
    return <Providers onBack={goBack} />;
  }

  if (screen === 'profiles') {
    return <Profiles onBack={goBack} onNavigateToProviders={() => navigate('providers')} />;
  }

  if (screen === 'agents') {
    return <Agents dev={dev} onBack={goBack} />;
  }

  if (screen === 'settings') {
    return <Settings onBack={goBack} />;
  }

  return <MainMenu onSelect={navigate} onExit={exit} />;
}
