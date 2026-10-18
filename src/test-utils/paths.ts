import path from 'node:path';

/**
 * Path helpers for test expectations.
 *
 * - `p` follows the host platform, exactly like the runtime code under test that
 *   calls `path.join`. Use it where the expectation must match the runtime.
 * - `posix` / `win32` build an explicit representation regardless of the host.
 *   Use them for config-format expectations and for win32 cases run on Linux.
 *
 * Do not blanket-replace POSIX literals with `p`: that would hide a bug where
 * a backslash leaks into a path on Linux.
 */

/** Host-platform join (`path.join`). */
export const p = (...segments: string[]): string => path.join(...segments);

/** POSIX join (`/`), independent of the host. */
export const posix = (...segments: string[]): string => path.posix.join(...segments);

/** Windows join (`\`), independent of the host. */
export const win32 = (...segments: string[]): string => path.win32.join(...segments);

/** Rewrites separators of an existing string to `/`. */
export const posixPath = (value: string): string => value.replace(/\\/g, '/');

/** Rewrites separators of an existing string to `\`. */
export const winPath = (value: string): string => value.replace(/\//g, '\\');
