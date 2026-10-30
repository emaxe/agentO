import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { backupExists } from '../../config/store.js';
import { restoreBackupForAgent } from '../../config/backup-restore.js';
import { listAdapters } from '../../agents/registry.js';
import { StatusLine } from '../components/StatusLine.js';

const SCOPES: Array<'global' | 'project'> = ['global', 'project'];
const VIEWPORT = 12;

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
  const [confirmRestore, setConfirmRestore] = useState<AgentStatus | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlyModified, setOnlyModified] = useState(false);
  const help = useHelp();

  const loadStatuses = useCallback(() => {
    const adapters = listAdapters({ dev });
    const cwd = process.cwd();
    const result: AgentStatus[] = [];
    for (const adapter of adapters) {
      const paths = adapter.configPaths(cwd);
      for (const scope of SCOPES) {
        result.push({
          adapterId: adapter.id,
          displayName: adapter.displayName,
          scope,
          configPath: paths[scope],
          modified: backupExists(adapter.id, scope, cwd),
        });
      }
    }
    setStatuses(result);
  }, [dev]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  const lower = query.trim().toLowerCase();
  const filteredStatuses = statuses.filter((entry) => {
    if (onlyModified && !entry.modified) return false;
    if (!lower) return true;
    return `${entry.displayName} ${entry.scope} ${entry.configPath}`.toLowerCase().includes(lower);
  });

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filteredStatuses.length - 1)));
  }, [query, onlyModified, statuses.length, filteredStatuses.length]);

  const performRestore = useCallback(
    (target: AgentStatus) => {
      const adapter = listAdapters({ dev }).find((a) => a.id === target.adapterId);
      if (!adapter) return;
      const restoreCwd = process.cwd();
      setConfirmRestore(null);
      setStatus('');
      restoreBackupForAgent(adapter, target.scope, restoreCwd)
        .then((restored) => {
          if (!restored) {
            setStatus('No backup found');
            return;
          }
          setStatus(`Restored ${target.displayName} [${target.scope}]`);
          loadStatuses();
        })
        .catch((err) => setStatus(`Error: ${String(err)}`));
    },
    [dev, loadStatuses],
  );

  useKeyInput((input, key) => {
    if (!searchOpen && help.handleKey(input, key)) return;

    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setQuery('');
        return;
      }
      if (key.return) {
        setSearchOpen(false);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(Math.max(0, filteredStatuses.length - 1), i + 1));
        return;
      }
      if (
        input.length > 0 &&
        !key.ctrl &&
        !key.meta &&
        [...input].every((char) => char >= ' ' && char <= '~')
      ) {
        setQuery((q) => q + input);
        setSelectedIndex(0);
        return;
      }
      return;
    }

    if (confirmRestore) {
      const lowerInput = input.toLowerCase();
      if (key.return || lowerInput === 'y') {
        performRestore(confirmRestore);
        return;
      }
      if (key.escape || lowerInput === 'n' || input === 'q') {
        setConfirmRestore(null);
        return;
      }
      return;
    }

    if (key.escape || input === 'q') {
      if (query) {
        setQuery('');
        setSelectedIndex(0);
        return;
      }
      onBack();
      return;
    }
    if (input === '/') {
      setSearchOpen(true);
      return;
    }
    if (input === 'f') {
      setOnlyModified((value) => !value);
      return;
    }
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, filteredStatuses.length - 1), i + 1));
    } else if (input === 'r' && filteredStatuses[selectedIndex]?.modified) {
      const target = filteredStatuses[selectedIndex];
      if (target) {
        setStatus('');
        setConfirmRestore(target);
      }
    }
  });

  if (help.open) {
    return <HelpOverlay topic="agents" />;
  }

  if (confirmRestore) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>
          Restore {confirmRestore.displayName} [{confirmRestore.scope}]?
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            This replaces the current config with the original saved before the last launch and
            clears the backup.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>y/Enter: restore | n/Esc: cancel</Text>
        </Box>
      </Box>
    );
  }

  const anchor = Math.min(selectedIndex, Math.max(0, filteredStatuses.length - 1));
  const start = Math.max(
    0,
    Math.min(anchor - Math.floor(VIEWPORT / 2), filteredStatuses.length - VIEWPORT),
  );
  const end = Math.min(filteredStatuses.length, start + VIEWPORT);
  const visible = filteredStatuses.slice(start, end);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Agent Config Status</Text>
      <Text dimColor>
        ↑↓ navigate | r: restore | f: modified only | /: search | ? help | Esc: back
      </Text>
      <StatusLine message={status} />
      {(searchOpen || query || onlyModified) && (
        <Text color={searchOpen ? 'cyan' : undefined} dimColor={!searchOpen}>
          {searchOpen
            ? `Search: ${query}▌`
            : query
              ? `filter: "${query}"`
              : 'filter: modified only'}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {start > 0 && <Text dimColor> ↑ {start} more</Text>}
        {visible.map((s, rel) => {
          const i = start + rel;
          return (
            <Box key={`${s.adapterId}-${s.scope}`} flexDirection="column">
              <Text color={i === selectedIndex ? 'green' : undefined}>
                {i === selectedIndex ? '▶ ' : '  '}
                {s.displayName} [{s.scope}]:{' '}
                <Text color={s.modified ? 'yellow' : 'green'}>
                  {s.modified ? 'modified' : 'original'}
                </Text>
                {s.modified && i === selectedIndex && <Text dimColor> (press r to restore)</Text>}
              </Text>
              {i === selectedIndex && (
                <Text dimColor>
                  {' → '}
                  {s.configPath}
                </Text>
              )}
            </Box>
          );
        })}
        {end < filteredStatuses.length && (
          <Text dimColor> ↓ {filteredStatuses.length - end} more</Text>
        )}
        {filteredStatuses.length === 0 && (
          <Text dimColor>
            {query || onlyModified ? 'No matching agent configs.' : 'No agents registered.'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
