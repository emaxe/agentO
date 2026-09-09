import { useState, useEffect, useRef, useCallback } from 'react';
import type { Key } from 'ink';
import {
  readConfig,
  readAgentStatusCache,
  writeAgentStatusCache,
  type AgentInstallStatus,
} from '../../config/store.js';
import { restoreBackupForAgent } from '../../config/backup-restore.js';
import { listAgents } from '../../agents/registry.js';
import { canRunProfile } from '../../agents/compatibility.js';
import { prepareChild } from '../../launcher/child.js';
import { launchIndependent } from '../../launcher/independent.js';
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

type Step = 'profile' | 'agent' | 'install' | 'action' | 'launching';

interface LaunchWizardProps {
  dev?: boolean;
  onBack: () => void;
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
  const [installAgentId, setInstallAgentId] = useState<AgentId | null>(null);
  const [actionAgentId, setActionAgentId] = useState<AgentId | null>(null);
  const [actionMode, setActionMode] = useState<'update' | 'uninstall' | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<
    Record<string, 'pending' | 'checking' | 'done'>
  >({});
  const [errorChoice, setErrorChoice] = useState(0);
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
  const visibleAgents = currentProfile
    ? getCompatibleAgents(listAgents({ dev }), currentProfile, providers)
    : listAgents({ dev });

  useEffect(() => {
    readConfig()
      .then((config) => {
        setProfiles(config.profiles);
        setProviders(config.providers);
        setSettings(config.settings);
        setLaunchMode(config.settings.defaultLaunchMode);
        setLaunchScope(config.settings.defaultConfigScope);
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
    setError(launchError.error || `Agent ${launchError.agentId} not installed`);
    setStep('agent');
  }, [profiles, launchError]);

  useEffect(() => {
    if (step !== 'agent') return;

    const currentStatuses = installStatusesRef.current;
    const agents = listAgents({ dev });
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
          setInstallStatuses((prev) => {
            const next = { ...prev };
            for (const [id, installed] of agentResults) next[id] = installed;
            return next;
          });
        })
        .catch(() => {
          /* assume installed on error */
        })
        .finally(() => {
          setStatusChecking(false);
        });
    }, 0);
  }, [step, dev]);

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
    const agents = listAgents({ dev });
    const profile = profiles[selectedProfile];
    const compatibleAgents = profile ? getCompatibleAgents(agents, profile, providers) : agents;
    const agentEntry = compatibleAgents[selectedAgent];

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
    dev,
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
    const agents = listAgents({ dev });
    const profile = profiles[selectedProfile];
    const compatibleAgents = profile ? getCompatibleAgents(agents, profile, providers) : agents;
    const agentEntry = compatibleAgents[selectedAgent];
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
  }, [dev, profiles, providers, selectedProfile, selectedAgent, settings, launchScope, doLaunch]);

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
      if (step === 'install') return;
      if (step === 'action') return;
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
      const setSelected = step === 'profile' ? setSelectedProfile : setSelectedAgent;

      if (key.upArrow) {
        setSelected(Math.max(0, selected - 1));
      } else if (key.downArrow) {
        setSelected(Math.min(items.length - 1, selected + 1));
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
          setSelectedAgent(0);
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
      profiles,
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
      canOverwrite: step === 'launching' && error !== '' && isBackupConflictError(error),
    },
  };
}
