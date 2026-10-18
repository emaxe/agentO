import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { sanitizeFieldValue } from '../sanitize-field-value.js';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  focus: boolean;
  placeholder?: string;
  showCursor?: boolean;
  onSubmit?: () => void;
}

export function TextField({
  label,
  value,
  onChange,
  focus,
  placeholder,
  showCursor,
  onSubmit,
}: TextFieldProps): React.JSX.Element {
  return (
    <Box>
      <Text color={focus ? 'green' : undefined}>
        {focus ? '▶ ' : '  '}
        {label}{' '}
      </Text>
      <TextInput
        value={value}
        onChange={(v) => onChange(sanitizeFieldValue(v))}
        focus={focus}
        showCursor={showCursor ?? focus}
        placeholder={placeholder}
        onSubmit={onSubmit}
      />
    </Box>
  );
}
