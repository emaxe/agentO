import React, { useState } from 'react';
import { Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useTerminalSize } from '../use-terminal-size.js';

export function ScrollableLines({
  lines,
  reserved = 8,
  width: requestedWidth,
}: {
  lines: string[];
  reserved?: number;
  width?: number;
}) {
  const { rows, columns } = useTerminalSize();
  const [offset, setOffset] = useState(0);
  const width = Math.max(10, requestedWidth ?? columns - 4);
  const wrapped = lines.flatMap((line) => {
    const chars = [...line];
    return Array.from({ length: Math.max(1, Math.ceil(chars.length / width)) }, (_, i) =>
      chars.slice(i * width, (i + 1) * width).join(''),
    );
  });
  const height = Math.max(3, rows - reserved);
  const max = Math.max(0, wrapped.length - height);
  const start = Math.min(offset, max);
  useKeyInput((_input, key) => {
    if (key.downArrow || key.pageDown)
      setOffset(Math.min(max, start + (key.pageDown ? height : 1)));
    if (key.upArrow || key.pageUp) setOffset(Math.max(0, start - (key.pageUp ? height : 1)));
  });
  return (
    <>
      {wrapped.slice(start, start + height).map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {max > 0 && (
        <Text dimColor>
          ↑↓ / PgUp/PgDn scroll · {start + 1}–{Math.min(start + height, wrapped.length)} /{' '}
          {wrapped.length}
        </Text>
      )}
    </>
  );
}
