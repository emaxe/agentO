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
    expect(frame).toContain('1-5');
  });

  it('selects items with number keys', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} onExit={() => {}} />);
    await settle();
    stdin.write('2');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('providers');
  });

  it('keeps Enter working after a number moves the cursor', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} onExit={() => {}} />);
    await settle();
    stdin.write('4');
    await settle();
    onSelect.mockClear();
    stdin.write('\r');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('agents');
  });
});
