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
 * Maps every ЙЦУКЕН character in `value` to its QWERTY equivalent; everything else
 * passes through untouched.
 *
 * Text fields (API keys, URLs) cannot contain Cyrillic, but the terminal delivers
 * whatever the active keyboard layout produces. Mapping the whole value — not just
 * single keypresses — also repairs a character that was typed with the wrong layout
 * earlier, because the next keystroke re-sends the entire field value.
 */
export function mapRussianLayout(value: string): string {
  let mapped = '';
  for (const char of value) mapped += RU_TO_EN[char] ?? char;
  return mapped;
}
