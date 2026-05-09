import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { ExecRequest } from '../launcher/independent.js';

export interface StartTuiOptions {
  dev?: boolean;
}

export async function startTui(options: StartTuiOptions = {}): Promise<ExecRequest | null> {
  let execRequest: ExecRequest | null = null;

  const { waitUntilExit } = render(
    React.createElement(App, {
      dev: options.dev,
      onExec: (req: ExecRequest) => {
        execRequest = req;
      },
    }),
  );

  await waitUntilExit();
  return execRequest;
}
