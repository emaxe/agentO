import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { backupExists, readBackup, deleteBackup } from '../../config/store.js';
import { listAdapters } from '../../agents/registry.js';

const SCOPES: Array<'global' | 'project'> = ['global', 'project'];

/** Snapshot of an agent's configuration state for display. */
interface AgentStatus {
  adapterId: string;
  displayName: string;
  scope: 'global' | 'project';
  configPath: string;
  modified: boolean;
}

interface AgentsProps {
  dev?: boolean;
  onBack: () => void;
}

/** Ink component that displays agent config status and allows restoring from backup. */
export function Agents({ dev, onBack }: AgentsProps): React.JSX.Element {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState('');

  const loadStatuses = useCallback(() => {
    const adapters = listAdapters({ dev });
    const result: AgentStatus[] = [];
    for (const adapter of adapters) {
      const paths = adapter.configPaths();
      for (const scope of SCOPES) {
        result.push({
          adapterId: adapter.id,
          displayName: adapter.displayName,
          scope,
          configPath: paths[scope],
          modified: backupExists(adapter.id, scope),
        });
      }
    }
    setStatuses(result);
  }, [dev]);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  useKeyInput((input, key) => {
    if (key.escape || input === 'q') { onBack(); return; }
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelectedIndex((i) => Math.min(statuses.length - 1, i + 1));
    else if (input === 'r' && statuses[selectedIndex]?.modified) {
      const s = statuses[selectedIndex];
      if (!s) return;
      const adapter = listAdapters({ dev }).find((a) => a.id === s.adapterId);
      if (!adapter) return;
      readBackup(s.adapterId, s.scope)
        .then(async (backup) => {
          if (!backup) { setStatus('No backup found'); return; }
          await adapter.writeConfig(backup as Record<string, unknown>, s.scope);
          await deleteBackup(s.adapterId, s.scope);
        })
        .then(() => { setStatus(`Restored ${s.displayName} [${s.scope}]`); loadStatuses(); })
        .catch((err) => setStatus(`Error: ${String(err)}`));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Agent Config Status</Text>
      <Text dimColor>↑↓ navigate | r: restore (if modified) | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {statuses.map((s, i) => (
          <Box key={`${s.adapterId}-${s.scope}`} flexDirection="column">
            <Text color={i === selectedIndex ? 'green' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}
              {s.displayName} [{s.scope}]:{' '}
              <Text color={s.modified ? 'yellow' : 'green'}>
                {s.modified ? 'modified' : 'original'}
              </Text>
              {s.modified && i === selectedIndex && <Text dimColor> (press r to restore)</Text>}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
