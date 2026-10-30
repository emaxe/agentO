/**
 * Root TUI component. Manages screen routing between menu and sub-screens.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from 'ink';
import { SetupWizard } from './wizards/SetupWizard.js';
import { listAdapters } from '../agents/registry.js';
import { backupExists } from '../config/store.js';
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
export type Screen =
  'main' | 'setup' | 'repeat' | 'launch' | 'providers' | 'profiles' | 'agents' | 'settings';

interface AppProps {
  outcome?: { agent: string; recovery: string };
  dev?: boolean;
  initialScreen?: Screen;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
}

/** Root Ink component that switches between TUI screens. */
export function App({
  dev,
  outcome,
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
        const recoveryTargets = listAdapters({ dev }).flatMap((adapter) =>
          (['global', 'project'] as const)
            .filter((scope) => backupExists(adapter.id, scope, process.cwd()))
            .map((scope) => ({ agentId: adapter.id, scope })),
        );
        setMenuState({
          recoveryTarget: recoveryTargets[0],
          recoveryCount: recoveryTargets.length,
          providers: config.providers.length,
          profiles: config.profiles.length,
          ...(last && profile && agent
            ? {
                lastLaunch: {
                  profileName: profile.name,
                  model: (profile.models.find((m) => m.tier === 'base') ?? profile.models[0])
                    ?.model,
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
    return <MainMenu outcome={outcome} state={menuState} onSelect={navigate} onExit={exit} />;
  }

  if (screen === 'setup')
    return (
      <SetupWizard
        dev={dev}
        agentStatusCache={agentStatusCache}
        onBack={goBack}
        onExec={handleExec}
      />
    );

  if (screen === 'launch' || screen === 'repeat') {
    return (
      <LaunchAgent
        key={screen}
        repeatLast={screen === 'repeat'}
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
    return (
      <Agents
        agentStatusCache={agentStatusCache}
        dev={dev}
        initialTarget={menuState?.recoveryTarget}
        onBack={goBack}
      />
    );
  }

  if (screen === 'settings') {
    return <Settings onBack={goBack} />;
  }

  return <MainMenu onSelect={navigate} onExit={exit} />;
}
