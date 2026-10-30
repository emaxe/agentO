import { useInput, type Key } from 'ink';
import { mapRussianLayout } from './keyboard-layout.js';

/**
 * Drop-in replacement for Ink's `useInput` that also accepts Russian ЙЦУКЕН keyboard input.
 * Russian characters are transparently mapped to their QWERTY equivalents before the
 * handler is called, so all existing `input === 'x'` checks work without modification.
 * Hint text should remain English-only since the mapping is transparent to the user.
 */
export function useKeyInput(
  handler: (input: string, key: Key) => void,
  options: { textInput?: boolean } = {},
): void {
  useInput((input, key) => handler(options.textInput ? input : mapRussianLayout(input), key));
}
