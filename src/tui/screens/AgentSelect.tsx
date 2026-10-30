import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SelectList } from '../components/SelectList.js';
import type { AgentRegistryEntry } from '../../agents/registry.js';
import type { AgentInstallStatus } from '../../config/store.js';

interface AgentSelectProps {
  agents: readonly AgentRegistryEntry[];
  selected: number;
  installStatuses: Record<string, AgentInstallStatus>;
  checkProgress: Record<string, 'pending' | 'checking' | 'done'>;
  statusChecking: boolean;
  hiddenAgents?: readonly { label: string; reason: string }[];
  onSelect: (index: number) => void;
  onBack: () => void;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function AgentSelect({
  agents,
  selected,
  installStatuses,
  checkProgress,
  statusChecking,
  hiddenAgents = [],
}: AgentSelectProps): React.JSX.Element {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!statusChecking) return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % 10), 80);
    return () => clearInterval(id);
  }, [statusChecking]);

  if (statusChecking) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Select Agent</Text>
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {agents.map((item, i) => {
            const state = checkProgress[item.id] ?? 'pending';
            const icon =
              state === 'done' ? '✓' : state === 'checking' ? SPINNER_FRAMES[spinnerFrame] : '○';
            const color = state === 'done' ? 'green' : state === 'checking' ? 'yellow' : 'gray';
            return (
              <Text key={i} color={color} dimColor={state === 'pending'}>
                {icon} {item.label}
                {state === 'checking' && <Text dimColor> checking...</Text>}
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <SelectList
        items={agents}
        selected={selected}
        title="Select Agent"
        hint="↑↓ navigate, Enter select, v preview, Esc back, u update, d delete, m mode, s scope, ? help"
        emptyMessage="No items available"
        renderItem={(item, index, isSelected) => {
          const status = installStatuses[item.id];
          const installed = status?.installed !== false;
          return (
            <Text color={isSelected ? 'green' : undefined}>
              {isSelected ? '▶ ' : '  '}
              {item.label}
              {installed && status?.version ? <Text dimColor> v{status.version}</Text> : null}
              {!installed && <Text dimColor> (not installed)</Text>}
              {installed && isSelected && <Text dimColor> (u update, d delete)</Text>}
            </Text>
          );
        }}
      />
      {hiddenAgents.length > 0 && (
        <Box paddingX={2} marginTop={1} flexDirection="column">
          <Text dimColor>
            {hiddenAgents.length} agent{hiddenAgents.length === 1 ? '' : 's'} hidden for this
            profile:
          </Text>
          {hiddenAgents.map((agent) => (
            <Text key={agent.label} dimColor>
              {'  • '}
              {agent.label} — {agent.reason}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
