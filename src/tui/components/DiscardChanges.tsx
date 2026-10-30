import React, { useState } from 'react';
import { Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { ScreenFrame } from './ScreenFrame.js';

export function DiscardChanges({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const [discard, setDiscard] = useState(false);
  useKeyInput((input, key) => {
    if (key.upArrow || key.downArrow || key.tab) setDiscard((v) => !v);
    else if (key.escape || input.toLowerCase() === 'n') onKeep();
    else if (input.toLowerCase() === 'y') onDiscard();
    else if (key.return) (discard ? onDiscard : onKeep)();
  });
  return (
    <ScreenFrame title="Unsaved changes" actions="↑↓ choose | Enter confirm | Esc keep editing">
      <Text color={!discard ? 'green' : undefined}>{!discard ? '▶ ' : '  '}Keep editing</Text>
      <Text color={discard ? 'green' : undefined}>{discard ? '▶ ' : '  '}Discard changes</Text>
    </ScreenFrame>
  );
}
