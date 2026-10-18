/**
 * Box border style for the TUI.
 *
 * Legacy conhost with a raster font renders the rounded box-drawing characters as
 * squares, so a bare win32 console gets Ink's ASCII-ish `classic` style. Windows
 * Terminal (`WT_SESSION`) and hosted terminals (`TERM_PROGRAM`: VS Code etc.) keep `round`.
 */
export type TuiBorderStyle = 'round' | 'classic';

export function tuiBorderStyle(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): TuiBorderStyle {
  if (platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM) return 'classic';
  return 'round';
}
