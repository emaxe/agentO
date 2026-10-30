import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useStableSelection } from '../use-stable-selection.js';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import {
  backupExists,
  readAgentStatusCache,
  writeAgentStatusCache,
  type AgentInstallStatus,
} from '../../config/store.js';
import { restoreBackupForAgent } from '../../config/backup-restore.js';
import { RecoveryDetails } from '../components/RecoveryDetails.js';
import { AgentInstall } from './AgentInstall.js';
import { AgentAction } from './AgentAction.js';
import { getAgent } from '../../agents/registry.js';
import type { AgentId } from '../../config/schema.js';
import { useViewport } from '../use-terminal-size.js';
import { listAdapters } from '../../agents/registry.js';
import { StatusLine } from '../components/StatusLine.js';

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
  initialTarget?: { agentId?: string; scope: 'global' | 'project'; cwd?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
  onAgentStatusChange?: (id: string, status: AgentInstallStatus) => void;
  dev?: boolean;
  onBack: () => void;
}

/** Ink component that displays agent config status and allows restoring from backup. */
export function Agents({
  dev,
  onBack,
  initialTarget,
  agentStatusCache,
  onAgentStatusChange,
}: AgentsProps): React.JSX.Element {
  const VIEWPORT = useViewport(13);
  const [busy, setBusy] = useState(false);
  const [management, setManagement] = useState<{
    agentId: AgentId;
    mode: 'install' | 'update' | 'uninstall';
  } | null>(null);
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
    const cwd = initialTarget?.cwd ?? process.cwd();
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
    if (initialTarget) {
      const index = result.findIndex(
        (s) => s.adapterId === initialTarget.agentId && s.scope === initialTarget.scope,
      );
      setSelectedIndex(Math.max(0, index));
    }
  }, [dev, initialTarget?.agentId, initialTarget?.scope, initialTarget?.cwd]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  const lower = query.trim().toLowerCase();
  const filteredStatuses = statuses.filter((entry) => {
    if (onlyModified && !entry.modified) return false;
    if (!lower) return true;
    return `${entry.displayName} ${entry.scope} ${entry.configPath}`.toLowerCase().includes(lower);
  });

  useStableSelection(
    filteredStatuses.map((item) => `${item.adapterId}:${item.scope}`),
    selectedIndex,
    setSelectedIndex,
  );

  const performRestore = useCallback(
    (target: AgentStatus) => {
      const adapter = listAdapters({ dev }).find((a) => a.id === target.adapterId);
      if (!adapter) return;
      const restoreCwd = initialTarget?.cwd ?? process.cwd();
      setBusy(true);
      setStatus('Restoring...');
      restoreBackupForAgent(adapter, target.scope, restoreCwd)
        .then((restored) => {
          if (!restored) {
            setStatus('No backup found');
            return;
          }
          setConfirmRestore(null);
          setStatus(`Restored ${target.displayName} [${target.scope}]`);
          loadStatuses();
        })
        .catch((err) => setStatus(`Error: ${String(err)}`))
        .finally(() => setBusy(false));
    },
    [dev, loadStatuses, initialTarget?.cwd],
  );

  useKeyInput(
    (input, key) => {
      if (management || busy) return;
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
          setQuery((q) => [...q].slice(0, -1).join(''));
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
          [...input].every(
            (char) => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127,
          )
        ) {
          setQuery((q) => q + input);
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
      if (input === 'i' || input === 'u' || input === 'd') {
        const id = filteredStatuses[selectedIndex]?.adapterId;
        const agent = id ? getAgent(id) : undefined;
        if (agent?.installer)
          setManagement({
            agentId: agent.id,
            mode: input === 'i' ? 'install' : input === 'u' ? 'update' : 'uninstall',
          });
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
    },
    { textInput: searchOpen },
  );

  const finishManagement = async (success: boolean) => {
    if (!management) return;
    const action = management;
    setManagement(null);
    if (!success) return;
    const status = { installed: action.mode !== 'uninstall' };
    if (agentStatusCache) agentStatusCache[action.agentId] = status;
    onAgentStatusChange?.(action.agentId, status);
    setBusy(true);
    try {
      const cache = await readAgentStatusCache();
      await writeAgentStatusCache({ ...cache, [action.agentId]: status });
      setStatus(`${action.agentId}: ${status.installed ? 'installed' : 'uninstalled'}`);
    } catch (err) {
      setStatus(`Error: agent changed, but status cache could not be saved: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (management)
    return management.mode === 'install' ? (
      <AgentInstall
        agentId={management.agentId}
        onBack={() => setManagement(null)}
        onDone={() => {
          void finishManagement(true);
        }}
      />
    ) : (
      <AgentAction
        agentId={management.agentId}
        mode={management.mode}
        onBack={() => setManagement(null)}
        onDone={(result) => {
          void finishManagement(result.success);
        }}
      />
    );

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
        <RecoveryDetails
          agentId={confirmRestore.adapterId}
          scope={confirmRestore.scope}
          cwd={initialTarget?.cwd}
        />
        <StatusLine message={status} />
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
      <Text bold>Agents & recovery</Text>
      {initialTarget?.cwd && initialTarget.cwd !== process.cwd() && (
        <Text dimColor wrap="truncate-middle">
          Directory: {initialTarget.cwd}
        </Text>
      )}
      <Text dimColor>
        ↑↓ choose | r restore | i install | u update | d uninstall | f modified | / search | Esc
        back
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
                <Text dimColor wrap="truncate-middle">
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
