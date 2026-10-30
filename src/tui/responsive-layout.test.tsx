import React from 'react';
import { Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectList } from './components/SelectList.js';
import { ProviderList } from './screens/ProviderList.js';
import { LaunchPreviewScreen } from './screens/LaunchPreview.js';
import type { LaunchPreview } from '../launcher/preview.js';
import { p } from '../test-utils/paths.js';

const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
function size(columns: number, rows: number) {
  Object.defineProperty(process.stdout, 'columns', { configurable: true, value: columns });
  Object.defineProperty(process.stdout, 'rows', { configurable: true, value: rows });
  process.stdout.emit('resize');
}
afterEach(() => {
  cleanup();
  if (originalRows) Object.defineProperty(process.stdout, 'rows', originalRows);
  else Reflect.deleteProperty(process.stdout, 'rows');
  if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
  else Reflect.deleteProperty(process.stdout, 'columns');
});
const wait = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('responsive TUI', () => {
  it('keeps the selected row in view across 120×40 → 80×24 → 120×40 resizes', async () => {
    size(120, 40);
    const ui = render(
      <SelectList
        title="Models"
        items={Array.from({ length: 60 }, (_, i) => i)}
        selected={37}
        renderItem={(item, i, selected) => (
          <Text>
            {selected ? '▶ ' : '  '}row-{item}
          </Text>
        )}
      />,
    );
    await wait();
    expect(ui.lastFrame()).toContain('▶ row-37');
    const large = ui.lastFrame()!.split('\n').length;
    size(80, 24);
    await wait();
    expect(ui.lastFrame()).toContain('▶ row-37');
    expect(ui.lastFrame()!.split('\n').length).toBeLessThan(large);
    size(120, 40);
    await wait();
    expect(ui.lastFrame()).toContain('▶ row-37');
  });
  it.each([
    [80, 24],
    [120, 40],
  ])('bounds provider details and launch review at %s×%s', (columns, rows) => {
    size(columns!, rows!);
    const provider = {
      id: 'p',
      name: 'Provider',
      type: 'openai-compatible' as const,
      apiKey: 'secret',
      models: Array.from({ length: 100 }, (_, i) => ({
        name: `long-model-name-${i}`,
        capabilities: { image: true, video: false, audio: false },
      })),
    };
    const list = render(
      <ProviderList
        providers={[provider]}
        selected={0}
        onSelect={() => {}}
        onAdd={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onBack={() => {}}
        status="Error: operation failed"
      />,
    );
    expect(list.lastFrame()!.split('\n').length).toBeLessThanOrEqual(rows!);
    expect(list.lastFrame()).toContain('operation failed');
    expect(list.lastFrame()).toContain('▶ Provider');
    expect(list.lastFrame()).toContain('Esc: back');
    list.unmount();
    const preview: LaunchPreview = {
      agentId: 'codex',
      agentLabel: 'Codex',
      profileName: 'work',
      model: 'm',
      providerName: 'Provider',
      cwd: p('work', 'project'),
      mode: 'child',
      scope: 'project',
      envOnly: false,
      files: [
        { path: p('home', 'config.toml'), action: 'update' },
        { path: p('work', 'project', 'config.toml'), action: 'create' },
      ],
      envKeys: [],
      backup: { active: false },
      gitExclude: [],
      warnings: Array.from({ length: 60 }, (_, i) => `Warning detail ${i}`),
    };
    const review = render(<LaunchPreviewScreen preview={preview} />);
    expect(review.lastFrame()!.split('\n').length).toBeLessThanOrEqual(rows!);
    expect(review.lastFrame()).toContain('Enter launch');
    expect(review.lastFrame()).toContain('scroll');
  });
});
