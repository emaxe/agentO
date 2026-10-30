import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInstall } from './AgentInstall.js';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  checkEnvironment: vi.fn(),
  install: vi.fn(),
}));
vi.mock('../../agents/registry.js', () => ({ getAgent: mocks.getAgent }));

const views: ReturnType<typeof render>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkEnvironment.mockResolvedValue({ ok: true, missing: [] });
  mocks.install.mockResolvedValue({ success: true });
  mocks.getAgent.mockReturnValue({
    label: 'Test Agent',
    installer: {
      checkEnvironment: mocks.checkEnvironment,
      install: mocks.install,
      manualInstructions: {
        commands: ['npm install -g test-agent'],
        docsUrl: 'https://example.test/install',
      },
    },
  });
});
afterEach(() => {
  for (const view of views.splice(0)) view.unmount();
  vi.restoreAllMocks();
});

async function waitForFrame(view: ReturnType<typeof render>, text: string) {
  await vi.waitFor(() => expect(view.lastFrame()).toContain(text));
  // Ink subscribes to stdin in an effect after rendering the new screen.
  await new Promise((resolve) => setImmediate(resolve));
}

async function setup() {
  const onBack = vi.fn();
  const onDone = vi.fn();
  const view = render(<AgentInstall agentId="qwen" onBack={onBack} onDone={onDone} />);
  views.push(view);
  await waitForFrame(view, 'Auto-install');
  return { ...view, onBack, onDone };
}

describe('agent installation wizard', () => {
  it('checks prerequisites, installs, then continues only after confirmation', async () => {
    const view = await setup();
    view.stdin.write('\r');
    await waitForFrame(view, 'installed successfully');
    expect(mocks.checkEnvironment).toHaveBeenCalledOnce();
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(view.onDone).not.toHaveBeenCalled();
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.onDone).toHaveBeenCalledOnce());
  });

  it('shows manual instructions without running an installer', async () => {
    const view = await setup();
    view.stdin.write('\u001B[B');
    await waitForFrame(view, '▶ Manual install');
    view.stdin.write('\r');
    await waitForFrame(view, 'npm install -g test-agent');
    expect(view.lastFrame()).toContain('https://example.test/install');
    expect(mocks.checkEnvironment).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    view.stdin.write('\u001B');
    await waitForFrame(view, '▶ Auto-install');
    expect(view.onBack).not.toHaveBeenCalled();
  });

  it('returns to the previous screen on Escape from the initial choice', async () => {
    const view = await setup();
    view.stdin.write('\u001B');
    await vi.waitFor(() => expect(view.onBack).toHaveBeenCalledOnce());
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('offers manual installation when prerequisites are missing', async () => {
    mocks.checkEnvironment.mockResolvedValue({ ok: false, missing: ['npm', 'node'] });
    const view = await setup();
    view.stdin.write('\r');
    await waitForFrame(view, 'Missing: npm, node');
    expect(mocks.install).not.toHaveBeenCalled();
    view.stdin.write('\r');
    await waitForFrame(view, 'npm install -g test-agent');
  });

  it('can retry after a failed install', async () => {
    mocks.install.mockResolvedValueOnce({ success: false, error: 'Permission denied' });
    const view = await setup();
    view.stdin.write('\r');
    await waitForFrame(view, 'Permission denied');
    expect(view.onDone).not.toHaveBeenCalled();
    view.stdin.write('\r');
    await waitForFrame(view, 'installed successfully');
    expect(mocks.checkEnvironment).toHaveBeenCalledTimes(2);
    expect(mocks.install).toHaveBeenCalledTimes(2);
  });

  it.each(['environment', 'installation'] as const)(
    'shows a rejected %s operation as a recoverable error',
    async (stage) => {
      (stage === 'environment' ? mocks.checkEnvironment : mocks.install).mockRejectedValueOnce(
        new Error('Network unavailable'),
      );
      const view = await setup();
      view.stdin.write('\r');
      await waitForFrame(view, 'Network unavailable');
      expect(view.lastFrame()).toContain('Retry');
      expect(view.onDone).not.toHaveBeenCalled();
      if (stage === 'environment') expect(mocks.install).not.toHaveBeenCalled();
      view.stdin.write('\u001B');
      await waitForFrame(view, 'Auto-install');
    },
  );

  it('ignores duplicate submissions and Escape while the installer is running', async () => {
    let finish!: (value: { success: boolean }) => void;
    mocks.install.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = await setup();
    try {
      view.stdin.write('\r');
      await waitForFrame(view, 'Installing...');
      view.stdin.write('\r');
      view.stdin.write('\u001B');
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.install).toHaveBeenCalledOnce();
      expect(view.onBack).not.toHaveBeenCalled();
      expect(view.lastFrame()).toContain('Installing...');
    } finally {
      finish({ success: true });
    }
    await waitForFrame(view, 'installed successfully');
  });

  it('reports a missing installer without calling external commands', async () => {
    mocks.getAgent.mockReturnValue({ label: 'Test Agent' });
    const view = await setup();
    view.stdin.write('\r');
    await waitForFrame(view, 'Installer not found');
    expect(mocks.install).not.toHaveBeenCalled();
    expect(view.onDone).not.toHaveBeenCalled();
  });
});
