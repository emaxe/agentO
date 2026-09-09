/**
 * The status line shared by the list screens.
 *
 * Two behaviors the plain `<Text color="green">` got wrong: an `Error: ...`
 * message must not be painted in success green, and a message must eventually
 * disappear on its own — stale "Deleted" lines lingering on screen make the
 * user think they just deleted something again.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusLine, statusColor } from './StatusLine.js';

describe('statusColor', () => {
  it('marks error messages red', () => {
    expect(statusColor('Error: EACCES')).toBe('red');
  });

  it('marks ordinary status messages green', () => {
    expect(statusColor('Deleted "Fireworks"')).toBe('green');
  });
});

describe('StatusLine', () => {
  it('renders nothing when there is no message', () => {
    const { lastFrame } = render(<StatusLine message="" />);
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders the message when one is set', () => {
    const { lastFrame } = render(<StatusLine message="Saved" hideAfterMs={10_000} />);
    expect(lastFrame()).toContain('Saved');
  });

  it('hides the message after the timeout', async () => {
    const { lastFrame } = render(<StatusLine message="Deleted" hideAfterMs={40} />);
    expect(lastFrame()).toContain('Deleted');
    await new Promise((r) => setTimeout(r, 150));
    expect(lastFrame() ?? '').not.toContain('Deleted');
  });

  it('shows a new message even after a previous one expired', async () => {
    const { rerender, lastFrame } = render(<StatusLine message="Deleted" hideAfterMs={40} />);
    await new Promise((r) => setTimeout(r, 150));
    rerender(<StatusLine message="Saved" hideAfterMs={10_000} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Saved');
  });
});
