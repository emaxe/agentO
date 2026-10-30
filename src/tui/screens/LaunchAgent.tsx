import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { useLaunchWizard } from '../hooks/useLaunchWizard.js';
import { RecoveryDetails } from '../components/RecoveryDetails.js';
import { ProfileEdit } from './ProfileEdit.js';
import { Agents } from './Agents.js';
import { ProfileSelect } from './ProfileSelect.js';
import { AgentSelect } from './AgentSelect.js';
import { AgentInstall } from './AgentInstall.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { ScrollableLines } from '../components/ScrollableLines.js';
import { LaunchPreviewScreen } from './LaunchPreview.js';
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
  initialProfileId?: string;
  repeatLast?: boolean;
  forceReview?: boolean;
  dev?: boolean;
  onBack: () => void;
  onNavigate?: (target: 'providers' | 'profiles' | 'setup') => void;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
}

export function LaunchAgent({
  initialProfileId,
  repeatLast,
  forceReview,
  dev,
  onBack,
  onNavigate,
  onExec,
  launchError,
  agentStatusCache,
}: LaunchAgentProps): React.JSX.Element {
  const { state, actions, computed } = useLaunchWizard({
    initialProfileId,
    repeatLast,
    forceReview,
    dev,
    onBack,
    onNavigate,
    onExec,
    launchError,
    agentStatusCache,
  });

  const help = useHelp();
  const [errorDetails, setErrorDetails] = useState(false);
  useKeyInput(
    (input, key) => {
      if (state.error && input === 't') {
        setErrorDetails((value) => !value);
        return;
      }
      if (state.error && errorDetails) {
        if (key.escape) setErrorDetails(false);
        return;
      }
      if (state.error || state.step === 'preview') {
        actions.handleKey(input, key);
        return;
      }
      if (state.step !== 'profile' && state.step !== 'agent') return;
      if (help.handleKey(input, key)) return;
      actions.handleKey(input, key);
    },
    { textInput: state.searchOpen },
  );

  if (help.open) {
    return <HelpOverlay topic="launch" />;
  }

  if (state.step === 'edit-profile' && computed.currentProfile)
    return (
      <ProfileEdit
        profile={computed.currentProfile}
        providers={state.providers}
        profiles={state.profiles}
        onSave={actions.saveProfile}
        onCancel={actions.returnToAgent}
      />
    );
  if (state.step === 'recovery')
    return (
      <Agents
        agentStatusCache={agentStatusCache}
        onAgentStatusChange={actions.setAgentStatus}
        dev={dev}
        onBack={actions.returnToAgent}
        initialTarget={
          computed.recoveryTarget ?? {
            agentId: computed.visibleAgents[state.selectedAgent]?.id,
            scope: state.launchScope,
          }
        }
      />
    );

  if (state.error) {
    if (errorDetails)
      return (
        <ScreenFrame title="Launch error details" actions="t/Esc: back">
          <ScrollableLines lines={[state.error]} />
        </ScreenFrame>
      );
    const choices = computed.canOverwrite ? ['Restore previous config and launch', 'Back'] : [];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" wrap="truncate-end">
          Error:{' '}
          {computed.canOverwrite
            ? 'A previous launch still has a config backup.'
            : state.error.replace(/^Error:\s*/, '')}
        </Text>
        <Text dimColor>t: technical details | r: retry | a: recovery | Esc: back</Text>
        {computed.canOverwrite && (
          <RecoveryDetails
            agentId={computed.visibleAgents[state.selectedAgent]!.id}
            scope={state.launchScope}
          />
        )}
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
      </Box>
    );
  }

  if (state.step === 'profile' && state.settings === null && !state.error) {
    return (
      <Box padding={1}>
        <Text dimColor>Loading configuration...</Text>
      </Box>
    );
  }

  if (state.step === 'profile' && state.settings !== null && state.profiles.length === 0) {
    const needsProvider = state.providers.length === 0;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Select Profile</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">No profiles yet.</Text>
          <Text dimColor>
            {needsProvider
              ? 'Start by adding a provider, then create a profile.'
              : 'Create a profile to choose models from your providers.'}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">{'Enter: Set up AgentO'}</Text>
          <Text dimColor>Esc: back</Text>
        </Box>
      </Box>
    );
  }

  if (state.step === 'profile') {
    return (
      <Box flexDirection="column">
        <ProfileSelect
          profiles={state.filteredProfiles}
          providers={state.providers}
          query={state.query}
          searchOpen={state.searchOpen}
          selected={Math.max(
            0,
            state.filteredProfiles.findIndex((p) => p.id === computed.currentProfile?.id),
          )}
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

  if (state.step === 'preview') {
    return <LaunchPreviewScreen preview={state.preview} />;
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
          hiddenAgents={computed.hiddenAgents}
          showReasons={state.showReasons}
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

  return (
    <Box flexDirection="column" padding={1}>
      <Text>{state.status || 'Launching...'}</Text>
    </Box>
  );
}
