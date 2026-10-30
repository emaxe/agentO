/**
 * Escape-key behavior in the provider form.
 *
 * Esc used to have three meanings: cancel the form, or "move the cursor one
 * field back" when on the models/save rows — so users pressing Esc from the
 * save row thought the form was stuck. Esc now always cancels, asking first
 * only when there are unsaved edits.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ProviderForm } from './ProviderForm.js';

async function poll(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const frame = lastFrame() ?? '';
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`Never matched: ${what}\n${frame}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 100));

function openForm() {
  const onCancel = vi.fn();
  const utils = render(<ProviderForm providers={[]} onSubmit={() => {}} onCancel={onCancel} />);
  return { ...utils, onCancel };
}

describe('ProviderForm cancel', () => {
  it('Esc on a pristine form cancels immediately', async () => {
    const { stdin, onCancel } = openForm();
    await settle();
    stdin.write('\u001B');
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });

  it('Esc with typed edits asks for confirmation instead of silently discarding', async () => {
    const { stdin, lastFrame, onCancel } = openForm();
    await settle();
    stdin.write('Acme');
    await settle();
    stdin.write('\u001B');
    await poll(lastFrame, (f) => f.includes('Discard'), 'confirmation shown');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('confirming the discard prompt cancels', async () => {
    const { stdin, onCancel } = openForm();
    await settle();
    stdin.write('Acme');
    await settle();
    stdin.write('\u001B');
    await settle();
    stdin.write('y');
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });

  it('declining the discard prompt keeps editing', async () => {
    const { stdin, lastFrame, onCancel } = openForm();
    await settle();
    stdin.write('Acme');
    await settle();
    stdin.write('\u001B');
    await poll(lastFrame, (f) => f.includes('Discard'), 'confirmation shown');
    await settle();
    stdin.write('n');
    await poll(
      lastFrame,
      (f) => !f.includes('Discard') && f.includes('Add Provider'),
      'back to the form',
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Esc from the save row cancels (with confirmation) instead of nudging the cursor', async () => {
    const { stdin, lastFrame, onCancel } = openForm();
    await settle();
    stdin.write('Acme'); // make the form dirty
    await settle();
    // Focus the save row: tab all the way around the field list.
    for (let i = 0; i < 6; i++) {
      stdin.write('\t');
      await new Promise((r) => setTimeout(r, 40));
    }
    stdin.write('\u001B');
    await poll(lastFrame, (f) => f.includes('Discard'), 'confirmation from save row');
    await settle();
    stdin.write('y');
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });
});

async function enterModelSelection(
  stdin: { write: (d: string) => void },
  lastFrame: () => string | undefined,
  ids: string[],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: ids.map((id) => ({ id })) }),
    })),
  );
  await settle();
  for (let i = 0; i < 5; i++) {
    stdin.write('\t');
    await new Promise((r) => setTimeout(r, 40));
  }
  stdin.write('\r'); // run the API test
  await poll(lastFrame, (f) => f.includes('✓ OK'), 'API test succeeded');
  await settle();
  stdin.write('\t'); // focus the fetch-models row
  await settle();
  stdin.write('\r');
  await poll(lastFrame, (f) => f.includes('Select Models'), 'model selection opened');
  await settle();
}

describe('ProviderForm model selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('filters the list while typing and counts matches', async () => {
    const utils = render(<ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />);
    await enterModelSelection(utils.stdin, utils.lastFrame, [
      'alpha/one',
      'beta/two',
      'alpha/three',
    ]);
    utils.stdin.write('a');
    utils.stdin.write('l');
    utils.stdin.write('p');
    const frame = await poll(
      utils.lastFrame,
      (f) => !f.includes('beta/two') && f.includes('alpha/one'),
      'filtered to alpha/*',
    );
    expect(frame).toContain('alpha/three');
    expect(frame).toContain('[1/2]');
  });

  it('backspace edits the filter', async () => {
    const utils = render(<ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />);
    await enterModelSelection(utils.stdin, utils.lastFrame, ['x-ray', 'beta', 'xmas']);
    utils.stdin.write('x');
    await poll(utils.lastFrame, (f) => !f.includes('beta'), 'filtered to x*');
    await settle();
    utils.stdin.write('\x7f'); // backspace -> empty filter
    await poll(utils.lastFrame, (f) => f.includes('beta'), 'beta back in view');
  });

  it('PageDown jumps by the viewport size', async () => {
    const utils = render(<ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />);
    const ids = Array.from({ length: 25 }, (_, i) => `model-${String(i).padStart(2, '0')}`);
    await enterModelSelection(utils.stdin, utils.lastFrame, ids);
    utils.stdin.write('\u001B[6~'); // PageDown
    await poll(
      utils.lastFrame,
      (f) => f.includes('[15/25]'),
      'cursor jumped by the available height',
    );
  });

  it('space still toggles selection and does not leak into the filter', async () => {
    const utils = render(<ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />);
    await enterModelSelection(utils.stdin, utils.lastFrame, ['alpha/one', 'beta/two']);
    utils.stdin.write(' ');
    await poll(utils.lastFrame, (f) => f.includes('Selected: 1'), 'row checked');
    // The filter is still empty, so every row is visible.
    expect(utils.lastFrame()).toContain('beta/two');
  });
});

describe('ProviderForm API key keyboard layout', () => {
  /** Focus the apiKey field: name → type → apiKey. */
  async function focusApiKey(stdin: { write: (d: string) => void }) {
    await settle();
    stdin.write('\t');
    await settle();
    stdin.write('\t');
    await settle();
  }

  it('maps a Cyrillic letter typed in the key to the Latin key', async () => {
    const { stdin, lastFrame } = render(
      <ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />,
    );
    await focusApiKey(stdin);
    stdin.write('or-proxy-ke');
    await settle();
    stdin.write('н'); // "y" on the Russian layout
    await settle();
    expect(lastFrame()).not.toContain('or-proxy-key');
    stdin.write('\x12'); // Ctrl+R explicitly reveals the key
    const frame = await poll(lastFrame, (f) => f.includes('or-proxy-key'), 'key repaired');
    expect(frame).not.toContain('or-proxy-keн');
  });

  it('still allows Cyrillic in the provider name', async () => {
    const { stdin, lastFrame } = render(
      <ProviderForm providers={[]} onSubmit={() => {}} onCancel={vi.fn()} />,
    );
    await settle();
    stdin.write('Мой прокси');
    await poll(lastFrame, (f) => f.includes('Мой прокси'), 'Cyrillic name kept');
  });
});

const existingProvider = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme',
  type: 'openai-compatible' as const,
  apiKey: 'sk-test',
  models: [{ name: 'original', capabilities: { image: true, video: false, audio: false } }],
};
async function tabs(stdin: { write: (value: string) => void }, count: number) {
  for (let i = 0; i < count; i++) {
    stdin.write('\t');
    await settle();
  }
}

describe('ProviderForm draft and write recovery', () => {
  it('Escape cancels only the current model name edit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const ui = render(
      <ProviderForm
        provider={existingProvider}
        providers={[existingProvider]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await settle();
    await tabs(ui.stdin, 4);
    ui.stdin.write('\r');
    await settle();
    ui.stdin.write('\r');
    await settle();
    ui.stdin.write('-changed');
    await settle();
    expect(ui.lastFrame()).toContain('original-changed');
    ui.stdin.write('\u001B');
    await settle();
    expect(ui.lastFrame()).toContain('original');
    expect(ui.lastFrame()).not.toContain('changed');
    ui.stdin.write('\u001B');
    await settle();
    await tabs(ui.stdin, 2);
    ui.stdin.write('\r');
    await settle();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ models: existingProvider.models }),
    );
    ui.unmount();
  });
  it('defaults to Keep editing and retains the draft after Enter', async () => {
    const ui = openForm();
    await settle();
    ui.stdin.write('Draft');
    await settle();
    ui.stdin.write('\u001B');
    await poll(ui.lastFrame, (f) => f.includes('▶ Keep editing'), 'keep editing selected');
    await settle();
    ui.stdin.write('\r');
    await settle();
    expect(ui.lastFrame()).toContain('Draft');
    expect(ui.onCancel).not.toHaveBeenCalled();
    ui.unmount();
  });
  it('shows a rejected write, blocks duplicate saves, and can retry with the same data', async () => {
    let rejectWrite: (err: Error) => void = () => {};
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const ui = render(
      <ProviderForm
        provider={existingProvider}
        providers={[existingProvider]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await settle();
    await tabs(ui.stdin, 6);
    ui.stdin.write('\r');
    await poll(ui.lastFrame, (f) => f.includes('Saving...'), 'save pending');
    await settle();
    ui.stdin.write('\r');
    await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rejectWrite(new Error('EACCES: cannot write config'));
    await poll(ui.lastFrame, (f) => f.includes('Error: EACCES'), 'write error visible');
    expect(ui.lastFrame()).toContain('original');
    await settle();
    ui.stdin.write('\r');
    await poll(ui.lastFrame, (f) => f.includes('Saved'), 'retry succeeded');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]).toEqual(onSubmit.mock.calls[0]);
    ui.unmount();
  });
});
