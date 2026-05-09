import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { ExecRequest } from '../launcher/independent.js';

export async function startTui(): Promise<ExecRequest | null> {
  let execRequest: ExecRequest | null = null;

  const { waitUntilExit } = render(
    React.createElement(App, {
      onExec: (req: ExecRequest) => {
        execRequest = req;
      },
    }),
  );

  await waitUntilExit();
  return execRequest;
}
