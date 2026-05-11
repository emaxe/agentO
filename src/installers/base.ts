import type { AgentId } from '../config/schema.js';

export type { AgentId };

export interface InstallCheckResult {
  installed: boolean;
  version?: string;
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
  readonly manualInstructions: {
    commands: string[];
    docsUrl: string;
  };
}
