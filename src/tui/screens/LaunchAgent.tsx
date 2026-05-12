import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { readConfig, readAgentStatusCache, writeAgentStatusCache } from '../../config/store.js';
import { claudeCodeAdapter } from '../../adapters/claude-code.js';
import { openCodeAdapter } from '../../adapters/opencode.js';
import { qwenAdapter } from '../../adapters/qwen.js';
import { codexAdapter } from '../../adapters/codex.js';
import { copilotAdapter } from '../../adapters/copilot.js';
import { prepareChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import { getInstaller } from '../../installers/registry.js';
import { AgentInstall } from './AgentInstall.js';
import type { ExecRequest } from '../../launcher/independent.js';
import type { AgentId, Profile, Provider, ProviderType, Settings } from '../../config/schema.js';
import type { AgentAdapter } from '../../adapters/base.js';

/** Workflow steps inside the LaunchAgent screen. */
type Step = 'profile' | 'agent' | 'install' | 'launching';

interface LaunchAgentProps {
  dev?: boolean;
  onBack: () => void;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, boolean>;
}

/** All agents available for launching. */
const ALL_AGENTS: Array<{ id: string; label: string; adapter: AgentAdapter; command: string; args?: string[] }> = [
  { id: 'claude-code', label: 'Claude Code', adapter: claudeCodeAdapter, command: 'claude' },
  { id: 'opencode', label: 'OpenCode', adapter: openCodeAdapter, command: 'opencode' },
  { id: 'qwen', label: 'Qwen CLI', adapter: qwenAdapter, command: 'qwen' },
  { id: 'codex', label: 'Codex CLI', adapter: codexAdapter, command: 'codex', args: ['-p', 'default'] },
  { id: 'copilot', label: 'Copilot CLI', adapter: copilotAdapter, command: 'copilot' },
];

/** Returns the agent list, filtering out `dev` agents unless `dev` is true. */
function getAgents(dev = false): typeof ALL_AGENTS {
  if (dev) return ALL_AGENTS;
  return ALL_AGENTS.filter((a) => !a.adapter.dev);
}

/** Filters agents to those whose `supportedProviderTypes` cover every provider in the selected profile. */
function getCompatibleAgents(
  agents: typeof ALL_AGENTS,
  profile: Profile,
  providers: Provider[],
): typeof ALL_AGENTS {
  const providerTypes = new Set<ProviderType>();
  for (const model of profile.models) {
    const provider = providers.find((p) => p.id === model.providerId);
    if (provider) providerTypes.add(provider.type);
  }
  return agents.filter((a) =>
    [...providerTypes].every((t) => (a.adapter.supportedProviderTypes as readonly string[]).includes(t)),
  );
}

/**
 * LaunchAgent screen — multi-step wizard:
 * 1. Select profile
 * 2. Select compatible agent (with install-check)
 * 3. (Optional) Install wizard if agent not installed
 * 4. Launch agent (delegates to child or independent launcher)
 */
export function LaunchAgent({ dev, onBack, onExec, launchError, agentStatusCache }: LaunchAgentProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('profile');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [installStatuses, setInstallStatuses] = useState<Record<string, boolean>>(() => ({ ...agentStatusCache }));
  // Ref so the install-check effect always reads current statuses without adding
  // installStatuses to its dependency array (which would cause an infinite loop).
  const installStatusesRef = useRef(installStatuses);
  installStatusesRef.current = installStatuses;
  const [installAgentId, setInstallAgentId] = useState<AgentId | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<Record<string, 'pending' | 'checking' | 'done'>>({});
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    readConfig()
      .then((config) => {
        setProfiles(config.profiles);
        setProviders(config.providers);
        setSettings(config.settings);
      })
      .catch((err) => setError(String(err)));
    readAgentStatusCache()
      .then((cache) => {
        if (Object.keys(cache).length > 0) {
          setInstallStatuses((prev) => ({ ...prev, ...cache }));
        }
      })
      .catch(() => { /* ignore cache read errors */ });
  }, []);

  const launchErrorHandled = useRef(false);

  useEffect(() => {
    if (!launchError || launchErrorHandled.current || profiles.length === 0) return;
    launchErrorHandled.current = true;
    const idx = profiles.findIndex((p) => p.id === launchError.profileId);
    if (idx >= 0) setSelectedProfile(idx);
    setInstallStatuses((prev) => ({ ...prev, [launchError.agentId]: false }));
    setError(launchError.error || `Agent ${launchError.agentId} not installed`);
    setStep('agent');
  }, [profiles, launchError]);

  useEffect(() => {
    if (step !== 'agent') return;

    const currentStatuses = installStatusesRef.current;
    const agentsToCheck = ALL_AGENTS.filter((a) => currentStatuses[a.id] !== true);
    const initialProgress: Record<string, 'pending' | 'checking' | 'done'> = {};
    for (const a of ALL_AGENTS) {
      initialProgress[a.id] = currentStatuses[a.id] === true ? 'done' : agentsToCheck.some((x) => x.id === a.id) ? 'pending' : 'done';
    }
    setCheckProgress(initialProgress);

    if (agentsToCheck.length === 0) {
      setStatusChecking(true);
      setTimeout(() => setStatusChecking(false), 200);
      return;
    }

    setStatusChecking(true);
    setTimeout(() => {
      const checks = agentsToCheck.map(async (a) => {
        setCheckProgress((prev) => ({ ...prev, [a.id]: 'checking' }));
        const installer = getInstaller(a.id as AgentId);
        if (!installer) {
          setCheckProgress((prev) => ({ ...prev, [a.id]: 'done' }));
          return [a.id, true] as const;
        }
        const result = await installer.checkInstalled();
        setCheckProgress((prev) => ({ ...prev, [a.id]: 'done' }));
        return [a.id, result.installed] as const;
      });

      Promise.all([...checks, new Promise<void>((r) => setTimeout(r, 200))])
        .then((results) => {
          const agentResults = results.slice(0, -1) as [string, boolean][];
          setInstallStatuses((prev) => {
            const next = { ...prev };
            for (const [id, installed] of agentResults) next[id] = installed;
            return next;
          });
        })
        .catch(() => {/* assume installed on error */ })
        .finally(() => {
          setStatusChecking(false);
        });
    }, 0);
  }, [step]);

  useEffect(() => {
    // Intentional shared-reference mutation: propagates install statuses back to the
    // module-level cache in start.ts for cross-relaunch persistence within the same process.
    if (agentStatusCache) {
      Object.assign(agentStatusCache, installStatuses);
    }
    // Guard: skip disk write when state is still empty (initial mount before any checks run)
    // to avoid overwriting a valid on-disk cache with a blank object.
    if (Object.keys(installStatuses).length === 0) return;
    writeAgentStatusCache(installStatuses).catch(() => { /* ignore write errors */ });
  }, [installStatuses]);

  useEffect(() => {
    if (!statusChecking) return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % 10), 80);
    return () => clearInterval(id);
  }, [statusChecking]);

  useKeyInput((input, key) => {
    if (step === 'launching' && !error) return;
    if (step === 'install') return;
    if (step === 'agent' && statusChecking) return;

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
    const profile = profiles[selectedProfile];
    const compatibleAgents = profile
      ? getCompatibleAgents(agents, profile, providers)
      : agents;
    const items = step === 'profile' ? profiles : compatibleAgents;
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
        const agentEntry = compatibleAgents[selectedAgent];

        if (!profile || !agentEntry || !settings) {
          setError('Invalid selection');
          return;
        }

        if (installStatuses[agentEntry.id] === false) {
          setInstallAgentId(agentEntry.id as AgentId);
          setStep('install');
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
        setSelectedAgent(0);
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

  const profile = profiles[selectedProfile];
  const visibleAgents = profile
    ? getCompatibleAgents(getAgents(dev), profile, providers)
    : getAgents(dev);

  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  if (step === 'agent' && statusChecking) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Select Agent</Text>
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {visibleAgents.map((item, i) => {
            const state = checkProgress[item.id] ?? 'pending';
            const icon = state === 'done' ? '✓' : state === 'checking' ? SPINNER_FRAMES[spinnerFrame] : '○';
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

  if (step === 'agent') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Select Agent</Text>
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {visibleAgents.map((item, i) => {
            const installed = installStatuses[item.id] !== false;
            return (
              <Text key={i} color={i === selectedAgent ? 'green' : undefined}>
                {i === selectedAgent ? '▶ ' : '  '}
                {item.label}
                {!installed && (
                  <Text dimColor> (not installed)</Text>
                )}
              </Text>
            );
          })}
          {visibleAgents.length === 0 && <Text dimColor>No items available</Text>}
        </Box>
      </Box>
    );
  }

  if (step === 'install' && installAgentId) {
    return (
      <AgentInstall
        agentId={installAgentId}
        onBack={() => { setInstallAgentId(null); setStep('agent'); }}
        onDone={() => {
          setInstallStatuses((prev) => ({ ...prev, [installAgentId]: true }));
          setInstallAgentId(null);
          setStep('agent');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text>{status || 'Launching...'}</Text>
    </Box>
  );
}
