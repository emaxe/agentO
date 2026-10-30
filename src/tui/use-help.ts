/**
 * `?` opens help, and any close key while help is open is swallowed so the
 * underlying screen does not act on it. Call `handleKey` first in a screen's
 * input handler; a `true` result means the key belonged to help.
 */
import { useState } from 'react';
import type { Key } from 'ink';

export interface HelpController {
  open: boolean;
  handleKey: (input: string, key: Key) => boolean;
  close: () => void;
}

export function useHelp(): HelpController {
  const [open, setOpen] = useState(false);

  const handleKey = (input: string, key: Key): boolean => {
    if (open) {
      if (key.escape || key.return || input === '?' || input === 'q') {
        setOpen(false);
      }
      return true;
    }
    if (input === '?') {
      setOpen(true);
      return true;
    }
    return false;
  };

  return { open, handleKey, close: () => setOpen(false) };
}
