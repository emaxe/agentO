import type { ExecRequest } from '../launcher/independent.js';
import type { StartTuiOptions } from './start.js';

/** Spawns the agent and resolves once it exits. Rejects if it could not start. */
export type SpawnAgent = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => Promise<number | null>;

/** Renders the TUI and resolves with a launch request, or `null` when the user quits. */
export type StartTui = (options: StartTuiOptions) => Promise<ExecRequest | null>;

export interface RunTuiLoopDeps {
  startTui: StartTui;
  spawnAgent: SpawnAgent;
  /** Called before handing the terminal to the agent. */
  beforeSpawn?: () => void;
  /** Where launch warnings are printed — outside Ink's render loop. */
  warn?: (message: string) => void;
}

/** True for an ENOENT from spawn — the agent binary is not on PATH. */
export function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'ENOENT';
}

/**
 * Drives the TUI ⇄ agent cycle: show the UI, run whatever the user picked,
 * restore the config, repeat while a relaunch was requested.
 *
 * Extracted from `bin/agento.ts` so the failure paths are testable — the reason
 * the missing `cleanup()` below went unnoticed is that nothing exercised them.
 */
export async function runTuiLoop(
  { startTui, spawnAgent, beforeSpawn, warn = (message) => console.warn(message) }: RunTuiLoopDeps,
  options: StartTuiOptions = {},
): Promise<void> {
  let execReq = await startTui(options);

  while (execReq) {
    beforeSpawn?.();
    // Printed here rather than inside the TUI: writing to stdout while Ink
    // renders would corrupt the frame.
    for (const warning of execReq.warnings ?? []) {
      warn(`Warning: ${warning}`);
    }

    let missingCommand = false;
    try {
      await spawnAgent(execReq.command, execReq.args, execReq.env);
    } catch (err) {
      // Anything other than a missing binary is unexpected; let it propagate,
      // but only after the `finally` below has run.
      if (!isEnoent(err)) throw err;
      missingCommand = true;
    } finally {
      // Restoring the agent config has to happen on every path. Skipping it when
      // the launch failed left the config patched with its backup still active,
      // which blocks the next launch with "Active backup already exists" and
      // needs a manual `agento restore` to clear.
      await execReq.cleanup?.();
    }

    if (missingCommand) {
      execReq = await startTui({
        ...options,
        launchError: {
          agentId: execReq.agentId ?? execReq.command,
          profileId: execReq.profileId,
          error: `Command "${execReq.command}" not found`,
        },
      });
      continue;
    }

    if (!execReq.relaunch) break;
    execReq = await startTui(options);
  }
}
