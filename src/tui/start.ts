/**
 * Entry point for launching the interactive Terminal UI (TUI).
 *
 * Renders the Ink {@link App} component and blocks until the user exits.
 * If an agent launch was requested (e.g. from LaunchAgent screen), the
 * resulting {@link ExecRequest} is returned so the caller can spawn it.
 */
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { ExecRequest } from '../launcher/independent.js';

/** Cache of agent install statuses shared across TUI relaunches within a single process. */
const agentStatusCache: Record<string, boolean> = {};

export interface StartTuiOptions {
  dev?: boolean;
  launchError?: { agentId: string; profileId?: string; error?: string };
}

/**
 * Renders the TUI and waits until the user exits.
 * @returns An {@link ExecRequest} if the user triggered an agent launch, otherwise `null`.
 */
export async function startTui(options: StartTuiOptions = {}): Promise<ExecRequest | null> {
  let execRequest: ExecRequest | null = null;

  const { waitUntilExit } = render(
    React.createElement(App, {
      dev: options.dev,
      launchError: options.launchError,
      agentStatusCache,
      onExec: (req: ExecRequest) => {
        execRequest = req;
      },
    }),
  );

  await waitUntilExit();
  return execRequest;
}
