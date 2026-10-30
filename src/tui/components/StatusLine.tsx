import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

/** Success and failure statuses must never share a color. */
export function statusColor(message: string): 'red' | 'green' {
  return message.startsWith('Error') ? 'red' : 'green';
}

interface StatusLineProps {
  message: string;
  /** How long the message stays on screen before hiding itself. */
  hideAfterMs?: number;
}

/** Transient one-line feedback under a screen header; renders nothing when empty. */
export function StatusLine({
  message,
  hideAfterMs = 5000,
}: StatusLineProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!message) return;
    // Errors are the one message the user must be able to finish reading. A
    // success note ("Deleted") is safe to fade; a failure is not.
    if (message.startsWith('Error')) {
      setVisible(true);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), hideAfterMs);
    return () => clearTimeout(timer);
  }, [message, hideAfterMs]);

  if (!message || !visible) return null;
  return <Text color={statusColor(message)}>{message}</Text>;
}
