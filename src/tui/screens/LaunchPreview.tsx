import React from 'react';
import { Text } from 'ink';
import { describePreviewLines, type LaunchPreview } from '../../launcher/preview.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { ScrollableLines } from '../components/ScrollableLines.js';

export function LaunchPreviewScreen({ preview }: { preview: LaunchPreview | null }) {
  return (
    <ScreenFrame
      title="Launch Preview"
      step="Review → Launch"
      actions="Enter launch | m mode | s scope | Esc back"
    >
      {preview ? (
        <ScrollableLines
          lines={[
            ...describePreviewLines(preview),
            ...preview.warnings.map((warning) => `Warning: ${warning}`),
          ]}
        />
      ) : (
        <Text dimColor>Preparing preview...</Text>
      )}
    </ScreenFrame>
  );
}
