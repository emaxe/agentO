/**
 * Tests for `agento launch` command — mode/scope runtime validation (007).
 *
 * Validates that invalid --mode / --scope values are rejected before any
 * side-effects occur, and that valid values (or settings fallbacks) proceed
 * to the correct launcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLaunchCommand } from './launch.js';

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  /**
   * A minimal AgentAdapter-compatible mock object for "qwen".
   */
  const mockAdapter = {
    id: 'qwen',
    displayName: 'Qwen CLI',
    dev: false,
    supportedProviderTypes: ['openai-compatible', 'fireworks', 'openrouter'],
    configPaths: vi.fn(),
    readConfig: vi.fn(),
    buildConfig: vi.fn(),
    writeConfig: vi.fn(),
  };

  return {
    readConfig: vi.fn(),
    launchChild: vi.fn(),
    launchIndependent: vi.fn(),
    spawnSync: vi.fn(),
    listAgents: vi.fn(),
    getAgentCommand: vi.fn(),
    mockAdapter,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../config/store.js', () => ({
  readConfig: mocks.readConfig,
}));

vi.mock('../../launcher/child.js', () => ({
  launchChild: mocks.launchChild,
}));

vi.mock('../../launcher/independent.js', () => ({
  launchIndependent: mocks.launchIndependent,
}));

vi.mock('node:child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('../../agents/registry.js', () => ({
  listAgents: mocks.listAgents.mockReturnValue([{
    id: 'qwen',
    label: 'Qwen CLI',
    adapter: mocks.mockAdapter,
    command: 'qwen',
    args: [],
  }]),
  getAgentCommand: mocks.getAgentCommand,
}));

// ---------------------------------------------------------------------------
// Base fixture data
// ---------------------------------------------------------------------------
const PROVIDER_ID = '00000000-0000-0000-0000-000000000001';

const baseConfig = {
  providers: [{
    id: PROVIDER_ID,
    name: 'MyProvider',
    type: 'openai-compatible',
    apiKey: 'k',
    baseUrl: 'https://api.example.com',
    models: [{ name: 'qwen-max', capabilities: { image: true, video: false, audio: false } }],
  }],
  profiles: [{
    id: '00000000-0000-0000-0000-000000000002',
    name: 'default',
    models: [{ providerId: PROVIDER_ID, model: 'qwen-max' }],
  }],
  settings: {
    defaultLaunchMode: 'child',
    defaultConfigScope: 'global',
    independentMode: 'pty',
  },
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function runLaunch(args: string[]): Promise<void> {
  const command = createLaunchCommand();
  await command.parseAsync(args, { from: 'user' });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('launch command — mode/scope validation', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default readConfig return value
    mocks.readConfig.mockResolvedValue(structuredClone(baseConfig));

    // Default agent registry mocks
    mocks.listAgents.mockReturnValue([{
      id: 'qwen',
      label: 'Qwen CLI',
      adapter: mocks.mockAdapter,
      command: 'qwen',
      args: [],
    }]);

    mocks.getAgentCommand.mockReturnValue({
      adapter: mocks.mockAdapter,
      command: 'qwen',
      args: [],
    });

    // Default launchers
    mocks.launchChild.mockResolvedValue(0);
    mocks.launchIndependent.mockResolvedValue({ command: 'qwen', args: [], env: {} });

    // Spy on process.exit and console.error
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: invalid --mode
  // -------------------------------------------------------------------------
  it('rejects invalid --mode before writing configs', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--mode', 'chlid']);

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Invalid mode: chlid. Supported: child, independent',
    );
    expect(mocks.launchChild).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: invalid --scope
  // -------------------------------------------------------------------------
  it('rejects invalid --scope before writing configs', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--scope', 'workspace']);

    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Invalid scope: workspace. Supported: global, project',
    );
    expect(mocks.launchChild).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: valid --mode child
  // -------------------------------------------------------------------------
  it('accepts --mode child and launches', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--mode', 'child']);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mocks.launchChild).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: valid --mode independent
  // -------------------------------------------------------------------------
  it('accepts --mode independent and launches', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--mode', 'independent']);

    expect(mocks.launchIndependent).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: valid --scope global
  // -------------------------------------------------------------------------
  it('accepts --scope global and launches', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--scope', 'global']);

    expect(mocks.launchChild).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // Test 6: valid --scope project
  // -------------------------------------------------------------------------
  it('accepts --scope project and launches', async () => {
    await runLaunch(['-p', 'default', '-a', 'qwen', '--scope', 'project']);

    expect(mocks.launchChild).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // Test 7: falls back to settings.defaultLaunchMode when --mode is omitted
  // -------------------------------------------------------------------------
  it('falls back to settings when --mode is not provided', async () => {
    const config = structuredClone(baseConfig);
    config.settings.defaultLaunchMode = 'child';
    mocks.readConfig.mockResolvedValue(config);

    // No --mode flag
    await runLaunch(['-p', 'default', '-a', 'qwen']);

    expect(mocks.launchChild).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: falls back to settings.defaultConfigScope when --scope is omitted
  // -------------------------------------------------------------------------
  it('falls back to settings when --scope is not provided', async () => {
    const config = structuredClone(baseConfig);
    config.settings.defaultConfigScope = 'global';
    mocks.readConfig.mockResolvedValue(config);

    // No --scope flag
    await runLaunch(['-p', 'default', '-a', 'qwen']);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(mocks.launchChild).toHaveBeenCalled();
  });
});
