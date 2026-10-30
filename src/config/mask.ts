/**
 * Display helper for secrets in the TUI and CLI.
 *
 * Never render an API key in full: the list views and `agento provider list`
 * only need enough to tell providers apart. Showing the first characters
 * (the old behaviour) leaked the key prefix; the last four are enough for a
 * human to recognise a key without exposing its beginning.
 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const tail = secret.length > 8 ? secret.slice(-4) : '';
  return tail ? `••••••••${tail}` : '••••••••';
}
