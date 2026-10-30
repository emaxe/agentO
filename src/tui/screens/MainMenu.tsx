import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { useTerminalSize } from '../use-terminal-size.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import type { Screen } from '../App.js';
import { VERSION } from '../../config/version.js';
import { tuiBorderStyle } from '../border-style.js';

export interface MainMenuState {
  providers: number;
  profiles: number;
  error?: string;
  recoveryCount?: number;
  recoveryTarget?: { agentId: string; scope: 'global' | 'project' };
  lastLaunch?: {
    profileName: string;
    agentLabel: string;
    model?: string;
    mode: string;
    scope: string;
  };
}

export function MainMenu({
  onSelect,
  onExit,
  state,
  outcome,
}: {
  onSelect: (screen: Screen) => void;
  onExit: () => void;
  state?: MainMenuState;
  outcome?: { agent: string; recovery: string };
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const help = useHelp();
  const { columns } = useTerminalSize();
  const items: { label: string; screen: Screen }[] = [
    state?.lastLaunch
      ? { label: 'Launch last (r)', screen: 'repeat' }
      : { label: 'Set up AgentO', screen: 'setup' },
    { label: 'New launch', screen: 'launch' },
    { label: 'Profiles', screen: 'profiles' },
    { label: 'Providers', screen: 'providers' },
    { label: 'Agents & recovery', screen: 'agents' },
    { label: 'Settings', screen: 'settings' },
  ];
  useKeyInput((input, key) => {
    if (help.handleKey(input, key)) return;
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(items.length - 1, i + 1));
    else if (key.return) onSelect(items[selected]!.screen);
    else if (input === 'r' && state?.lastLaunch) onSelect('repeat');
    else if (input === 'b' && state?.recoveryCount) onSelect('agents');
    else if (input === 'q' || key.escape) onExit();
    else if (/^[1-6]$/.test(input)) {
      const i = Number(input) - 1;
      setSelected(i);
      onSelect(items[i]!.screen);
    }
  });
  if (help.open) return <HelpOverlay topic="main" />;
  return (
    <Box
      flexDirection="column"
      borderStyle={tuiBorderStyle()}
      paddingX={1}
      width={Math.min(100, columns)}
    >
      <Box justifyContent="space-between">
        <Text bold>AgentO</Text>
        <Text dimColor>v{VERSION}</Text>
      </Box>
      <Text dimColor wrap="truncate-middle">
        Directory: {process.cwd()}
      </Text>
      {state?.error ? (
        <Text color="red">Config error: {state.error}</Text>
      ) : (
        <Text dimColor>
          Providers: {state?.providers ?? 0} · Profiles: {state?.profiles ?? 0}
        </Text>
      )}
      {outcome && (
        <>
          <Text>{outcome.agent}</Text>
          <Text color={outcome.recovery.startsWith('Error') ? 'red' : 'green'}>
            {outcome.recovery}
          </Text>
        </>
      )}
      {!!state?.recoveryCount && (
        <Text color="yellow">
          {state.recoveryCount} config backup(s) need attention · b: open recovery
        </Text>
      )}
      <Box flexDirection="column" marginY={1}>
        {items.map((item, i) => (
          <Text key={item.screen} color={i === selected ? 'green' : undefined}>
            {i === selected ? '▶' : i + 1} {item.label}
          </Text>
        ))}
      </Box>
      {state?.lastLaunch ? (
        <>
          <Text>
            Last: {state.lastLaunch.profileName} → {state.lastLaunch.agentLabel} (
            {state.lastLaunch.mode}, {state.lastLaunch.scope})
          </Text>
          <Text dimColor wrap="truncate-end">
            Model: {state.lastLaunch.model}
          </Text>
        </>
      ) : (
        <Text dimColor>Set up a provider and profile, then launch in one guided flow.</Text>
      )}
      <Text dimColor>↑↓ navigate | Enter open | r repeat | 1-6 jump | ? help | q/Esc quit</Text>
    </Box>
  );
}
