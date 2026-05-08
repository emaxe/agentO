import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { readConfig } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import { launchChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import type { Profile, Provider } from '../../config/schema.js';
import type { AgentAdapter, LaunchScope } from '../../adapters/base.js';

const AGENTS: Array<{ id: string; label: string; adapter: AgentAdapter; command: string }> = [
  { id: 'claude-code', label: 'Claude Code', adapter: claudeCodeAdapter, command: 'claude' },
  { id: 'opencode', label: 'OpenCode', adapter: openCodeAdapter, command: 'opencode' },
];

const SCOPES: Array<{ value: LaunchScope; label: string }> = [
  { value: 'global', label: 'Global config' },
  { value: 'project', label: 'Project config' },
];

const MODES: Array<{ value: 'child' | 'independent'; label: string }> = [
  { value: 'child', label: 'Child (wait for exit)' },
  { value: 'independent', label: 'Independent (detached)' },
];

type Step = 'profile' | 'agent' | 'scope' | 'mode' | 'launching';

interface LaunchAgentProps {
  onBack: () => void;
}

export function LaunchAgent({ onBack }: LaunchAgentProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('profile');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [selectedScope, setSelectedScope] = useState(0);
  const [selectedMode, setSelectedMode] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    readConfig()
      .then((config) => {
        setProfiles(config.profiles);
        setProviders(config.providers);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useInput((input, key) => {
    if (step === 'launching') return;

    if (key.escape || input === 'q') {
      if (step === 'profile') {
        onBack();
        return;
      }
      const steps: Step[] = ['profile', 'agent', 'scope', 'mode'];
      const idx = steps.indexOf(step);
      if (idx > 0) setStep(steps[idx - 1] as Step);
      return;
    }

    const items =
      step === 'profile' ? profiles :
      step === 'agent' ? AGENTS :
      step === 'scope' ? SCOPES : MODES;

    const selected =
      step === 'profile' ? selectedProfile :
      step === 'agent' ? selectedAgent :
      step === 'scope' ? selectedScope : selectedMode;

    const setSelected =
      step === 'profile' ? setSelectedProfile :
      step === 'agent' ? setSelectedAgent :
      step === 'scope' ? setSelectedScope : setSelectedMode;

    if (key.upArrow) {
      setSelected(Math.max(0, selected - 1));
    } else if (key.downArrow) {
      setSelected(Math.min(items.length - 1, selected + 1));
    } else if (key.return) {
      if (step === 'profile' && profiles.length === 0) {
        setError('No profiles configured. Add one first.');
        return;
      }

      const nextStep: Record<Step, Step> = {
        profile: 'agent',
        agent: 'scope',
        scope: 'mode',
        mode: 'launching',
        launching: 'launching',
      };
      const next = nextStep[step];
      setStep(next);

      if (next === 'launching') {
        const profile = profiles[selectedProfile];
        const agentEntry = AGENTS[selectedAgent];
        const scope = SCOPES[selectedScope].value;
        const mode = MODES[selectedMode].value;

        if (!profile || !agentEntry) {
          setError('Invalid selection');
          return;
        }

        setStatus(`Launching ${agentEntry.label}...`);

        const launchOptions = {
          adapter: agentEntry.adapter,
          profile,
          providers,
          scope,
          command: agentEntry.command,
        };

        if (mode === 'child') {
          launchChild(launchOptions)
            .then((exitCode) => {
              setStatus(`Done (exit code: ${exitCode})`);
            })
            .catch((err) => setError(String(err)));
        } else {
          launchIndependent(launchOptions)
            .then(() => {
              setStatus('Launched (detached)');
            })
            .catch((err) => setError(String(err)));
        }
      }
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {error}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const renderList = <T extends { label?: string; name?: string }>(
    items: T[],
    selected: number,
    title: string,
  ): React.JSX.Element => (
    <Box flexDirection="column" padding={1}>
      <Text bold>{title}</Text>
      <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, i) => (
          <Text key={i} color={i === selected ? 'green' : undefined}>
            {i === selected ? '▶ ' : '  '}
            {'label' in item ? item.label : item.name}
          </Text>
        ))}
        {items.length === 0 && <Text dimColor>No items available</Text>}
      </Box>
    </Box>
  );

  if (step === 'profile') return renderList(profiles, selectedProfile, 'Select Profile');
  if (step === 'agent') return renderList(AGENTS, selectedAgent, 'Select Agent');
  if (step === 'scope') return renderList(SCOPES, selectedScope, 'Select Config Scope');
  if (step === 'mode') return renderList(MODES, selectedMode, 'Select Launch Mode');

  return (
    <Box flexDirection="column" padding={1}>
      <Text>{status || 'Launching...'}</Text>
    </Box>
  );
}
