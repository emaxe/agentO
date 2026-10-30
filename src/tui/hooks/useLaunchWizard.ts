import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Key } from 'ink';
import {
  readConfig,
  readAgentStatusCache,
  writeAgentStatusCache,
  type AgentInstallStatus,
} from '../../config/store.js';
import { restoreBackupForAgent } from '../../config/backup-restore.js';
import { listAgents } from '../../agents/registry.js';
import { canRunProfile, describeIncompatibility } from '../../agents/compatibility.js';
import { readUiState, writeLastLaunch } from '../../config/ui-state.js';
import { prepareChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
import { describeLaunch, type LaunchPreview } from '../../launcher/preview.js';
import type {
  AgentId,
  LaunchMode,
  LaunchScope,
  Profile,
  Provider,
  Settings,
} from '../../config/schema.js';
import type { AgentRegistryEntry } from '../../agents/registry.js';
import type { ExecRequest } from '../../launcher/independent.js';
import type { InstallResult } from '../../installers/base.js';

type Step = 'profile' | 'agent' | 'preview' | 'install' | 'action' | 'launching';

interface LaunchWizardProps {
  dev?: boolean;
  onBack: () => void;
  onNavigate?: (target: 'providers' | 'profiles') => void;
  onExec?: (req: ExecRequest) => void;
  launchError?: { agentId: string; profileId?: string; error?: string };
  agentStatusCache?: Record<string, AgentInstallStatus>;
}

export interface LaunchWizardState {
  step: Step;
  profiles: Profile[];
  providers: Provider[];
  settings: Settings | null;
  selectedProfile: number;
  selectedAgent: number;
  status: string;
  error: string;
  installStatuses: Record<string, boolean>;
  checkProgress: Record<string, 'pending' | 'checking' | 'done'>;
  statusChecking: boolean;
  errorChoice: number;
  installAgentId: AgentId | null;
  actionAgentId: AgentId | null;
  actionMode: 'update' | 'uninstall' | null;
  preview: LaunchPreview | null;
}

/**
 * Filters the agent list down to the ones that can actually run this profile.
 *
 * Delegates to {@link canRunProfile} so the wizard and `agento launch` agree on
 * what "compatible" means. Exported for tests: this is what decides whether an
 * agent is offered to the user at all.
 */
export function getCompatibleAgents(
  agents: readonly AgentRegistryEntry[],
  profile: Profile,
  providers: Provider[],
): AgentRegistryEntry[] {
  return agents.filter((a) => canRunProfile(a.adapter, profile, providers));
}

function installRank(status?: AgentInstallStatus): number {
  if (!status) return 1;
  return status.installed ? 0 : 2;
}

/** Installed agents first, unknown in the middle, not-installed last. */
export function sortAgentsByInstall(
  agents: readonly AgentRegistryEntry[],
  statuses: Record<string, AgentInstallStatus>,
): AgentRegistryEntry[] {
  return [...agents].sort((a, b) => installRank(statuses[a.id]) - installRank(statuses[b.id]));
}

/**
 * True when a launch failed because an active backup blocks patching the config —
 * the one failure the "Overwrite and launch" recovery actually fixes. Other
 * launch errors (permissions, unreadable configs) must not offer it.
 */
export function isBackupConflictError(message: string): boolean {
  return message.includes('Active backup already exists');
}

export function useLaunchWizard({
  dev,
  onBack,
  onNavigate,
  onExec,
  launchError,
  agentStatusCache,
}: LaunchWizardProps) {
  const [step, setStep] = useState<Step>('profile');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [installStatuses, setInstallStatuses] = useState<Record<string, AgentInstallStatus>>(
    () => ({
      ...agentStatusCache,
    }),
  );
  const installStatusesRef = useRef(installStatuses);
  installStatusesRef.current = installStatuses;
  const selectedAgentIdRef = useRef<string | null>(null);
  const [installAgentId, setInstallAgentId] = useState<AgentId | null>(null);
  const [actionAgentId, setActionAgentId] = useState<AgentId | null>(null);
  const [actionMode, setActionMode] = useState<'update' | 'uninstall' | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<
    Record<string, 'pending' | 'checking' | 'done'>
  >({});
  const [errorChoice, setErrorChoice] = useState(0);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [launchMode, setLaunchMode] = useState<LaunchMode>('child');
  const [launchScope, setLaunchScope] = useState<LaunchScope>('project');

  const toggleMode = useCallback(
    () => setLaunchMode((m) => (m === 'child' ? 'independent' : 'child')),
    [],
  );
  const toggleScope = useCallback(
    () => setLaunchScope((s) => (s === 'project' ? 'global' : 'project')),
    [],
  );

  const currentProfile = profiles[selectedProfile];
  const allAgents = useMemo(() => listAgents({ dev }), [dev]);
  // Stable identity: selection effects and the preview depend on the order, not
  // on a fresh array produced by every render.
  const visibleAgents = useMemo(
    () =>
      sortAgentsByInstall(
        currentProfile ? getCompatibleAgents(allAgents, currentProfile, providers) : allAgents,
        installStatuses,
      ),
    [allAgents, currentProfile, providers, installStatuses],
  );
  const visibleAgentIds = new Set(visibleAgents.map((agent) => agent.id));
  const hiddenAgents = currentProfile
    ? allAgents
        .filter((agent) => !visibleAgentIds.has(agent.id))
        .map((agent) => ({
          id: agent.id,
          label: agent.label,
          reason:
            describeIncompatibility(agent.adapter, currentProfile, providers) ??
            'incompatible with this profile',
        }))
    : [];

  useEffect(() => {
    Promise.all([readConfig(), readUiState()])
      .then(([config, ui]) => {
        setProfiles(config.profiles);
        setProviders(config.providers);
        setSettings(config.settings);

        const last = ui.lastLaunch;
        const profileIndex = last
          ? config.profiles.findIndex((profile) => profile.id === last.profileId)
          : -1;
        const lastProfile = profileIndex >= 0 ? config.profiles[profileIndex] : undefined;

        setSelectedProfile(profileIndex >= 0 ? profileIndex : 0);
        setLaunchMode(last?.mode ?? config.settings.defaultLaunchMode);
        setLaunchScope(last?.scope ?? config.settings.defaultConfigScope);

        if (last && lastProfile) {
          const compatible = getCompatibleAgents(
            listAgents({ dev }),
            lastProfile,
            config.providers,
          );
          // Remember the agent id, not its index: install-status sorting can
          // reorder the list before the user reaches the agent step.
          if (compatible.some((agent) => agent.id === last.agentId)) {
            selectedAgentIdRef.current = last.agentId;
          }
        }
      })
      .catch((err) => setError(String(err)));
    readAgentStatusCache()
      .then((cache) => {
        if (Object.keys(cache).length > 0) {
          setInstallStatuses((prev) => ({ ...prev, ...cache }));
        }
      })
      .catch(() => {
        /* ignore cache read errors */
      });
  }, []);

  const launchErrorHandled = useRef(false);

  useEffect(() => {
    if (!launchError || launchErrorHandled.current || profiles.length === 0) return;
    launchErrorHandled.current = true;
    const idx = profiles.findIndex((p) => p.id === launchError.profileId);
    if (idx >= 0) setSelectedProfile(idx);
    setInstallStatuses((prev) => ({ ...prev, [launchError.agentId]: { installed: false } }));
    selectedAgentIdRef.current = launchError.agentId;
    setError(launchError.error || `Agent ${launchError.agentId} not installed`);
    setStep('agent');
  }, [profiles, launchError]);

  useEffect(() => {
    if (step !== 'agent') return;

    const currentStatuses = installStatusesRef.current;
    const agents = listAgents({ dev });
    if (!selectedAgentIdRef.current) {
      // Entering the step by another path (launch error): anchor on the row the
      // user is looking at, then keep that agent selected across re-sorting.
      selectedAgentIdRef.current = visibleAgents[selectedAgent]?.id ?? null;
    }

    const agentsToCheck = agents.filter((a) => currentStatuses[a.id]?.installed !== true);
    const initialProgress: Record<string, 'pending' | 'checking' | 'done'> = {};
    for (const a of agents) {
      initialProgress[a.id] =
        currentStatuses[a.id]?.installed === true
          ? 'done'
          : agentsToCheck.some((x) => x.id === a.id)
            ? 'pending'
            : 'done';
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
        const installer = a.installer;
        if (!installer) {
          setCheckProgress((prev) => ({ ...prev, [a.id]: 'done' }));
          return [a.id, { installed: true }] as const;
        }
        const result = await installer.checkInstalled();
        setCheckProgress((prev) => ({ ...prev, [a.id]: 'done' }));
        return [
          a.id,
          { installed: result.installed, ...(result.version ? { version: result.version } : {}) },
        ] as const;
      });

      Promise.all([...checks, new Promise<void>((r) => setTimeout(r, 200))])
        .then((results) => {
          const agentResults = results.slice(0, -1) as [string, AgentInstallStatus][];
          const nextStatuses = {
            ...currentStatuses,
            ...Object.fromEntries(agentResults),
          };
          // The selection-sync effect below moves the cursor when the reorder
          // happens, so the highlighted row and the launched agent stay aligned.
          setInstallStatuses(nextStatuses);
        })
        .catch(() => {
          /* assume installed on error */
        })
        .finally(() => {
          setStatusChecking(false);
        });
    }, 0);
  }, [step, dev]);

  // Keep the cursor on the same agent when install checks reorder the list.
  // The index is only a view into `visibleAgents`; the id is the source of truth.
  useEffect(() => {
    if (step !== 'agent') return;
    const id = selectedAgentIdRef.current;
    if (!id) {
      selectedAgentIdRef.current = visibleAgents[0]?.id ?? null;
      if (selectedAgent !== 0) setSelectedAgent(0);
      return;
    }
    const index = visibleAgents.findIndex((agent) => agent.id === id);
    if (index < 0) {
      selectedAgentIdRef.current = visibleAgents[0]?.id ?? null;
      if (selectedAgent !== 0) setSelectedAgent(0);
      return;
    }
    if (index !== selectedAgent) setSelectedAgent(index);
  }, [step, visibleAgents, selectedAgent]);

  useEffect(() => {
    if (step !== 'preview') return;
    const profile = profiles[selectedProfile];
    const agentEntry = visibleAgents[selectedAgent];
    if (!profile || !agentEntry) return;

    let cancelled = false;
    setPreview(null);
    setError('');
    describeLaunch({
      adapter: agentEntry.adapter,
      agentLabel: agentEntry.label,
      profile,
      providers,
      mode: launchMode,
      scope: launchScope,
      cwd: process.cwd(),
    })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(String(err));
        setStep('agent');
      });

    return () => {
      cancelled = true;
    };
  }, [
    step,
    launchMode,
    launchScope,
    selectedProfile,
    selectedAgent,
    profiles,
    providers,
    visibleAgents,
  ]);

  useEffect(() => {
    if (agentStatusCache) {
      Object.assign(agentStatusCache, installStatuses);
    }
    if (Object.keys(installStatuses).length === 0) return;
    writeAgentStatusCache(installStatuses).catch(() => {
      /* ignore write errors */
    });
  }, [installStatuses, agentStatusCache]);

  const doLaunch = useCallback(() => {
    const profile = profiles[selectedProfile];
    // Same list the user sees and navigates: sorting by install status must not
    // make Enter launch a different agent than the highlighted one.
    const agentEntry = visibleAgents[selectedAgent];

    if (!profile || !agentEntry || !settings) {
      setError('Invalid selection');
      return;
    }

    if (installStatuses[agentEntry.id]?.installed === false) {
      setInstallAgentId(agentEntry.id);
      setStep('install');
      return;
    }

    setStep('launching');
    setError('');
    setErrorChoice(0);
    setStatus(`Launching ${agentEntry.label}...`);

    const scope = launchScope;
    const mode = launchMode;

    writeLastLaunch({
      profileId: profile.id,
      agentId: agentEntry.id,
      mode,
      scope,
    }).catch(() => {
      /* the cache is a convenience; a failed write must not block a launch */
    });

    const launchOptions = {
      adapter: agentEntry.adapter,
      profile,
      providers,
      scope,
      command: agentEntry.command,
      args: agentEntry.args,
      cwd: process.cwd(),
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
  }, [
    visibleAgents,
    profiles,
    providers,
    selectedProfile,
    selectedAgent,
    settings,
    launchMode,
    launchScope,
    installStatuses,
    onExec,
  ]);

  const overwriteAndLaunch = useCallback(() => {
    const agentEntry = visibleAgents[selectedAgent];
    if (!agentEntry || !settings) {
      setError('Invalid selection');
      return;
    }
    const scope = launchScope;
    const restoreCwd = process.cwd();
    setStatus('Restoring backup...');
    setError('');
    restoreBackupForAgent(agentEntry.adapter, scope, restoreCwd)
      .then(() => {
        doLaunch();
      })
      .catch((err) => setError(String(err)));
  }, [visibleAgents, selectedAgent, settings, launchScope, doLaunch]);

  const handleKey = useCallback(
    (input: string, key: Key) => {
      if (step === 'launching' && error) {
        const canOverwrite = isBackupConflictError(error);
        if (key.escape || input === 'q' || input === 'b') {
          setError('');
          setStep('agent');
          setErrorChoice(0);
          return;
        }
        if (!canOverwrite) return;
        if (key.upArrow) {
          setErrorChoice((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setErrorChoice((c) => Math.min(1, c + 1));
          return;
        }
        if (key.return) {
          if (errorChoice === 0) {
            overwriteAndLaunch();
          } else {
            setError('');
            setStep('agent');
            setErrorChoice(0);
          }
          return;
        }
        return;
      }

      if (step === 'launching' && !error) return;

      if (step === 'preview') {
        if (key.escape || input === 'q' || input === 'b') {
          setStep('agent');
          return;
        }
        if (key.return) {
          doLaunch();
          return;
        }
        if (input === 'm') {
          toggleMode();
          return;
        }
        if (input === 's') {
          toggleScope();
          return;
        }
        return;
      }

      if (step === 'install') return;
      if (step === 'action') return;
      if (step === 'agent' && statusChecking) return;

      if (step === 'agent' && input === 'v') {
        setPreview(null);
        setError('');
        setStep('preview');
        return;
      }

      if (step === 'profile' && profiles.length === 0) {
        if (input === 'p') {
          onNavigate?.('providers');
          return;
        }
        if (input === 'a') {
          onNavigate?.('profiles');
          return;
        }
        if (key.return) {
          onNavigate?.(providers.length === 0 ? 'providers' : 'profiles');
          return;
        }
      }

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

      if (step === 'profile' || (step === 'agent' && !statusChecking)) {
        if (input === 'm') {
          toggleMode();
          return;
        }
        if (input === 's') {
          toggleScope();
          return;
        }
      }

      const items = step === 'profile' ? profiles : visibleAgents;
      const selected = step === 'profile' ? selectedProfile : selectedAgent;

      const moveSelection = (next: number): void => {
        if (step === 'profile') {
          setSelectedProfile(next);
          return;
        }
        setSelectedAgent(next);
        selectedAgentIdRef.current = visibleAgents[next]?.id ?? null;
      };

      if (key.upArrow) {
        moveSelection(Math.max(0, selected - 1));
      } else if (key.downArrow) {
        moveSelection(Math.min(items.length - 1, selected + 1));
      } else if (input === 'u' || input === 'd') {
        if (step !== 'agent') return;
        const agentEntry = visibleAgents[selectedAgent];
        if (
          agentEntry &&
          agentEntry.installer &&
          installStatuses[agentEntry.id]?.installed !== false &&
          (input === 'u' ? agentEntry.installer.update : agentEntry.installer.uninstall)
        ) {
          setActionAgentId(agentEntry.id);
          setActionMode(input === 'u' ? 'update' : 'uninstall');
          setStep('action');
        }
        return;
      } else if (key.return) {
        if (step === 'profile' && profiles.length === 0) {
          setError('No profiles configured. Add one first.');
          return;
        }

        if (step === 'agent') {
          doLaunch();
        } else {
          // Entering the agent step: keep the last-launched agent selected when
          // it is still offered, otherwise start at the first row.
          const preferred = selectedAgentIdRef.current;
          const preferredIndex = preferred
            ? visibleAgents.findIndex((agent) => agent.id === preferred)
            : -1;
          const next = preferredIndex >= 0 ? preferredIndex : 0;
          selectedAgentIdRef.current = visibleAgents[next]?.id ?? null;
          setSelectedAgent(next);
          setStep('agent');
        }
      }
    },
    [
      step,
      error,
      errorChoice,
      statusChecking,
      onBack,
      onNavigate,
      profiles,
      providers,
      visibleAgents,
      selectedProfile,
      selectedAgent,
      doLaunch,
      overwriteAndLaunch,
      installStatuses,
      toggleMode,
      toggleScope,
    ],
  );

  const completeInstall = useCallback(() => {
    if (!installAgentId) return;
    setInstallStatuses((prev) => ({ ...prev, [installAgentId]: { installed: true } }));
    setInstallAgentId(null);
    setStep('agent');
  }, [installAgentId]);

  const cancelInstall = useCallback(() => {
    setInstallAgentId(null);
    setStep('agent');
  }, []);

  const completeAction = useCallback(
    (agentId: AgentId, mode: 'update' | 'uninstall', result: InstallResult) => {
      if (result.success) {
        setInstallStatuses((prev) => {
          const next = { ...prev };
          next[agentId] = { installed: mode === 'update' };
          return next;
        });
      }
      setActionAgentId(null);
      setActionMode(null);
      setStep('agent');
    },
    [],
  );

  const cancelAction = useCallback(() => {
    setActionAgentId(null);
    setActionMode(null);
    setStep('agent');
  }, []);

  return {
    state: {
      step,
      profiles,
      providers,
      settings,
      selectedProfile,
      selectedAgent,
      status,
      error,
      installStatuses,
      checkProgress,
      statusChecking,
      errorChoice,
      installAgentId,
      actionAgentId,
      actionMode,
      preview,
      launchMode,
      launchScope,
    },
    actions: {
      handleKey,
      setSelectedProfile,
      setSelectedAgent,
      completeInstall,
      cancelInstall,
      completeAction,
      cancelAction,
    },
    computed: {
      currentProfile,
      visibleAgents,
      hiddenAgents,
      canOverwrite: step === 'launching' && error !== '' && isBackupConflictError(error),
    },
  };
}
