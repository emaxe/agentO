import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MainMenu } from './MainMenu.js';
import { HelpOverlay } from '../components/HelpOverlay.js';

const settle = () => new Promise((r) => setTimeout(r, 60));

describe('HelpOverlay', () => {
  it('explains child and independent for the launch topic', () => {
    const { lastFrame } = render(<HelpOverlay topic="launch" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('child: AgentO patches the config');
    expect(frame).toContain('independent: the patched config stays');
    expect(frame).toContain('global: the agent config');
    expect(frame).toContain('project: the agent config');
  });

  it('lists provider actions', () => {
    const { lastFrame } = render(<HelpOverlay topic="providers" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('test the API');
    expect(frame).toContain('duplicate');
    expect(frame).toContain('cannot be deleted');
  });
});

describe('MainMenu help', () => {
  it('opens with ? and closes with Escape without leaving the menu', async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(<MainMenu onSelect={onSelect} onExit={() => {}} />);

    await settle();
    stdin.write('?');
    await settle();
    expect(lastFrame()).toContain('AgentO — main menu');
    expect(onSelect).not.toHaveBeenCalled();

    stdin.write('\u001B');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Launch Agent');
    expect(frame).not.toContain('AgentO — main menu');
  });
});
