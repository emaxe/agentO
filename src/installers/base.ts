import type { AgentId } from '../config/schema.js';

export type { AgentId };

export interface InstallCheckResult {
  installed: boolean;
  version?: string;
  /** Why the agent was not detected; absent when `installed` is true. */
  reason?: 'not-found' | 'failed' | 'timeout';
}

export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

export interface AgentInstaller {
  readonly agentId: AgentId;
  checkInstalled(): Promise<InstallCheckResult>;
  checkEnvironment(): Promise<EnvCheckResult>;
  install(): Promise<InstallResult>;
  update?(): Promise<InstallResult>;
  uninstall?(): Promise<InstallResult>;
  readonly manualInstructions: {
    /** Commands for the platform the installer was created for. */
    commands: string[];
    docsUrl: string;
    /** Windows-specific commands, when they differ from `commands`. */
    windows?: { commands: string[] };
  };
}
