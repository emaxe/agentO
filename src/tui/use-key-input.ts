import { useInput, type Key } from 'ink';

// ЙЦУКЕН → QWERTY mapping. Case is preserved (й→q, Й→Q): confirmations distinguish `y` from `Y`,
// and Shift/CapsLock with a Russian layout must behave like the Latin key does.
const RU_LOWER = 'йцукенгшщзфывапролдячсмить';
const EN_LOWER = 'qwertyuiopasdfghjklzxcvbnm';

const RU_TO_EN: Record<string, string> = Object.fromEntries(
  [...RU_LOWER].flatMap((ru, i) => {
    const en = EN_LOWER[i] as string;
    return [
      [ru, en],
      [ru.toUpperCase(), en.toUpperCase()],
    ];
  }),
);

/**
 * Drop-in replacement for Ink's `useInput` that also accepts Russian ЙЦУКЕН keyboard input.
 * Russian characters are transparently mapped to their QWERTY equivalents before the
 * handler is called, so all existing `input === 'x'` checks work without modification.
 * Hint text should remain English-only since the mapping is transparent to the user.
 */
export function useKeyInput(handler: (input: string, key: Key) => void): void {
  useInput((input, key) => handler(RU_TO_EN[input] ?? input, key));
}
