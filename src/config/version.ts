import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function getVersion(): string {
  try {
    const pkg = require('../../../package.json') as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // Fallback when called from src directly
  }
  try {
    const pkg = require('../../package.json') as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // Fallback if package.json cannot be found
  }
  return '0.8.0';
}

export const VERSION = getVersion();
