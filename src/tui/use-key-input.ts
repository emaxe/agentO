import { useInput, type Key } from 'ink';

// ЙЦУКЕН → QWERTY mapping (lowercase only — terminal hotkeys are case-sensitive)
const RU_TO_EN: Record<string, string> = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u',
  'ш': 'i', 'щ': 'o', 'з': 'p',
  'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j',
  'л': 'k', 'д': 'l',
  'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm',
};

/**
 * Drop-in replacement for Ink's `useInput` that also accepts Russian ЙЦУКЕН keyboard input.
 * Russian characters are transparently mapped to their QWERTY equivalents before the
 * handler is called, so all existing `input === 'x'` checks work without modification.
 * Hint text should remain English-only since the mapping is transparent to the user.
 */
export function useKeyInput(handler: (input: string, key: Key) => void): void {
  useInput((input, key) => handler(RU_TO_EN[input] ?? input, key));
}
