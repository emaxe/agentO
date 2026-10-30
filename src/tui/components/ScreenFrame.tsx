import React from 'react';
import { Box, Text } from 'ink';
import { StatusLine } from './StatusLine.js';

export function ScreenFrame({
  title,
  step,
  status = '',
  actions,
  children,
}: {
  title: string;
  step?: string;
  status?: string;
  actions: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>
        {title}
        {step ? ` · ${step}` : ''}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {children}
      </Box>
      <StatusLine message={status} />
      <Text dimColor>{actions}</Text>
    </Box>
  );
}
