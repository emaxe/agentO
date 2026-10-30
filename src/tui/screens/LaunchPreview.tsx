/**
 * Read-only launch preview: what will be written, which env variables are set
 * (names only), the backup state and any warnings. `Enter` launches from here.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { describePreviewLines, type LaunchPreview } from '../../launcher/preview.js';

interface LaunchPreviewProps {
  preview: LaunchPreview | null;
}

export function LaunchPreviewScreen({ preview }: LaunchPreviewProps): React.JSX.Element {
  if (!preview) {
    return (
      <Box padding={1}>
        <Text dimColor>Preparing preview...</Text>
      </Box>
    );
  }

  const lines = describePreviewLines(preview);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Launch Preview</Text>
      <Text dimColor>Enter: launch | m: mode | s: scope | Esc: back</Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      {preview.warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {preview.warnings.map((warning) => (
            <Text key={warning} color="yellow">
              Warning: {warning}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
