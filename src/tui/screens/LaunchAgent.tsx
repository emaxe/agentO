import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { readConfig } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import { qwenAdapter } from '../../adapters/qwen.js';
import { codexAdapter } from '../../adapters/codex.js';
import { prepareChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import type { ExecRequest } from '../../launcher/independent.js';
import type { Profile, Provider, Settings } from '../../config/schema.js';
import type { AgentAdapter } from '../../adapters/base.js';

type Step = 'profile' | 'agent' | 'launching';

interface LaunchAgentProps {
  dev?: boolean;
  onBack: () => void;
  onExec?: (req: ExecRequest) => void;
}

const ALL_AGENTS: Array<{ id: string; label: string; adapter: AgentAdapter; command: string; args?: string[] }> = [
  { id: 'claude-code', label: 'Claude Code', adapter: claudeCodeAdapter, command: 'claude' },
  { id: 'opencode', label: 'OpenCode', adapter: openCodeAdapter, command: 'opencode' },
  { id: 'qwen', label: 'Qwen CLI', adapter: qwenAdapter, command: 'qwen' },
  { id: 'codex', label: 'Codex CLI', adapter: codexAdapter, command: 'codex', args: ['-p', 'default'] },
];

function getAgents(dev = false): typeof ALL_AGENTS {
  if (dev) return ALL_AGENTS;
  return ALL_AGENTS.filter((a) => !a.adapter.dev);
}

export function LaunchAgent({ dev, onBack, onExec }: LaunchAgentProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('profile');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    readConfig()
      .then((config) => {
        setProfiles(config.profiles);
        setProviders(config.providers);
        setSettings(config.settings);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useKeyInput((input, key) => {
    if (step === 'launching' && !error) return;

    if (key.escape || input === 'q') {
      if (step === 'profile') {
        onBack();
        return;
      }
      const steps: Step[] = ['profile', 'agent'];
      const idx = steps.indexOf(step);
      if (idx > 0) setStep(steps[idx - 1] as Step);
      return;
    }

    const agents = getAgents(dev);
    const items = step === 'profile' ? profiles : agents;
    const selected = step === 'profile' ? selectedProfile : selectedAgent;
    const setSelected = step === 'profile' ? setSelectedProfile : setSelectedAgent;

    if (key.upArrow) {
      setSelected(Math.max(0, selected - 1));
    } else if (key.downArrow) {
      setSelected(Math.min(items.length - 1, selected + 1));
    } else if (key.return) {
      if (step === 'profile' && profiles.length === 0) {
        setError('No profiles configured. Add one first.');
        return;
      }

      if (step === 'agent') {
        const profile = profiles[selectedProfile];
        const agentEntry = agents[selectedAgent];

        if (!profile || !agentEntry || !settings) {
          setError('Invalid selection');
          return;
        }

        setStep('launching');
        setStatus(`Launching ${agentEntry.label}...`);

        const scope = settings.defaultConfigScope;
        const mode = settings.defaultLaunchMode;

        const launchOptions = {
          adapter: agentEntry.adapter,
          profile,
          providers,
          scope,
          command: agentEntry.command,
          args: agentEntry.args,
        };

        if (mode === 'child') {
          prepareChild(launchOptions)
            .then(({ execReq, cleanup }) => {
              onExec?.({ ...execReq, relaunch: true, cleanup });
            })
            .catch((err) => setError(String(err)));
        } else {
          launchIndependent(launchOptions)
            .then((execReq) => {
              onExec?.(execReq);
            })
            .catch((err) => setError(String(err)));
        }
      } else {
        setStep('agent');
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
  if (step === 'agent') return renderList(getAgents(dev), selectedAgent, 'Select Agent');

  return (
    <Box flexDirection="column" padding={1}>
      <Text>{status || 'Launching...'}</Text>
    </Box>
  );
}
