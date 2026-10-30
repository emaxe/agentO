import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { SelectList } from './SelectList.js';

describe('SelectList viewport', () => {
  it('windows long lists around the cursor and reports hidden rows', () => {
    const items = Array.from({ length: 20 }, (_, i) => `row-${i}`);
    const { lastFrame } = render(
      <SelectList
        items={items}
        selected={12}
        maxVisible={10}
        renderItem={(item, index, isSelected) => (
          <Text>
            {isSelected ? '▶ ' : '  '}
            {index}:{item}
          </Text>
        )}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('↑ 7 more');
    expect(frame).toContain('▶ 12:row-12');
    expect(frame).toContain('↓ 3 more');
    expect(frame).not.toContain('row-0');
    expect(frame).not.toContain('row-19');
  });
});
