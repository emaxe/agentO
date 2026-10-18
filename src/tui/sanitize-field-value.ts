/**
 * Strips line breaks from a text field value.
 *
 * Windows Terminal delivers a multi-line paste as raw `\r`/`\n`, and `ink-text-input`
 * treats `\r` as Enter (submit). Fields here are single-line, so line breaks are dropped.
 */
export function sanitizeFieldValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}
