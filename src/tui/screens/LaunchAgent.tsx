import React from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useLaunchWizard } from '../hooks/useLaunchWizard.js';
import { ProfileSelect } from './ProfileSelect.js';
import { AgentSelect } from './AgentSelect.js';
import { AgentInstall } from './AgentInstall.js';
import { AgentAction } from './AgentAction.js';
import type { ExecRequest } from '../../launcher/independent.js';
import type { Profile } from '../../config/schema.js';
import type { AgentInstallStatus } from '../../config/store.js';

function LaunchFooter({
  mode,
  scope,
  profile,
}: {
  mode: string;
  scope: string;
  profile?: Profile | null;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      {profile && (
        <Text dimColor>{`Profile: ${profile.name} (${profile.models.length} models)`}</Text>
      )}
      <Text dimColor>{`mode: ${mode} (m)  |  scope: ${scope} (s)`}</Text>
    </Box>
  );
}

interface LaunchAgentProps {
  dev?: boolean;
  onBack: () => void;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
}

export function LaunchAgent({
  dev,
  onBack,
  onExec,
  launchError,
  agentStatusCache,
}: LaunchAgentProps): React.JSX.Element {
  const { state, actions, computed } = useLaunchWizard({
    dev,
    onBack,
    onExec,
    launchError,
    agentStatusCache,
  });

  useKeyInput(actions.handleKey);

  if (state.error) {
    const choices = computed.canOverwrite ? ['Overwrite and launch', 'Back'] : [];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {state.error.replace(/^Error:\s*/, '')}</Text>
        {computed.canOverwrite && (
          <Box flexDirection="column" marginTop={1}>
            {choices.map((c, i) => (
              <Text key={i} color={i === state.errorChoice ? 'green' : undefined}>
                {i === state.errorChoice ? '▶ ' : '  '}
                {c}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
            </Box>
          </Box>
        )}
        {!computed.canOverwrite && <Text dimColor>Press Esc to go back</Text>}
      </Box>
    );
  }

  if (state.step === 'profile') {
    return (
      <Box flexDirection="column">
        <ProfileSelect
          profiles={state.profiles}
          selected={state.selectedProfile}
          onSelect={actions.setSelectedProfile}
          onBack={onBack}
        />
        <LaunchFooter
          mode={state.launchMode}
          scope={state.launchScope}
          profile={computed.currentProfile}
        />
      </Box>
    );
  }

  if (state.step === 'agent') {
    return (
      <Box flexDirection="column">
        <AgentSelect
          agents={computed.visibleAgents}
          selected={state.selectedAgent}
          installStatuses={state.installStatuses}
          checkProgress={state.checkProgress}
          statusChecking={state.statusChecking}
          onSelect={actions.setSelectedAgent}
          onBack={onBack}
        />
        <LaunchFooter
          mode={state.launchMode}
          scope={state.launchScope}
          profile={computed.currentProfile}
        />
      </Box>
    );
  }

  if (state.step === 'install' && state.installAgentId) {
    return (
      <AgentInstall
        agentId={state.installAgentId}
        onBack={actions.cancelInstall}
        onDone={actions.completeInstall}
      />
    );
  }

  if (state.step === 'action' && state.actionAgentId && state.actionMode) {
    return (
      <AgentAction
        agentId={state.actionAgentId}
        mode={state.actionMode}
        onBack={actions.cancelAction}
        onDone={(result) => actions.completeAction(state.actionAgentId!, state.actionMode!, result)}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text>{state.status || 'Launching...'}</Text>
    </Box>
  );
}
