/**
 * MainMenu discoverability.
 *
 * The menu shipped no key hints at all — a first-run user sees five words and
 * has to guess. Numbers select items directly, matching the hint line.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MainMenu } from './MainMenu.js';

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('MainMenu', () => {
  it('shows the navigation hint', () => {
    const { lastFrame } = render(<MainMenu onSelect={() => {}} onExit={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('↑↓');
    expect(frame).toContain('Enter');
    expect(frame).toContain('1-6');
  });

  it('selects items with number keys', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} onExit={() => {}} />);
    await settle();
    stdin.write('4');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('providers');
  });

  it('keeps Enter working after a number moves the cursor', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} onExit={() => {}} />);
    await settle();
    stdin.write('5');
    await settle();
    onSelect.mockClear();
    stdin.write('\r');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('agents');
  });

  it('shows the first-run path when there are no profiles', () => {
    const { lastFrame } = render(
      <MainMenu onSelect={() => {}} onExit={() => {}} state={{ providers: 0, profiles: 0 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Providers: 0 · Profiles: 0');
    expect(frame).toContain('Set up AgentO');
    expect(frame).toContain('one guided flow');
  });

  it('shows the last launch when one is recorded', () => {
    const { lastFrame } = render(
      <MainMenu
        onSelect={() => {}}
        onExit={() => {}}
        state={{
          providers: 1,
          profiles: 1,
          lastLaunch: {
            profileName: 'work',
            agentLabel: 'Claude Code',
            mode: 'child',
            scope: 'global',
          },
        }}
      />,
    );
    expect(lastFrame()).toContain('Last: work → Claude Code (child, global)');
  });
  it('repeats the last launch with r', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <MainMenu
        onSelect={onSelect}
        onExit={() => {}}
        state={{
          providers: 1,
          profiles: 1,
          lastLaunch: {
            profileName: 'work',
            agentLabel: 'Goose',
            model: 'm1',
            mode: 'child',
            scope: 'project',
          },
        }}
      />,
    );
    await settle();
    stdin.write('r');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('repeat');
  });
});
