import { createHash } from 'node:crypto';
import type { DescribeLaunchOptions, LaunchPreview } from '../launcher/preview.js';

/** Versioned digest only: credentials and generated configs never enter the UI cache. */
export function launchFingerprint(
  options: DescribeLaunchOptions,
  preview: LaunchPreview,
  mergeEnabled: boolean,
): string {
  const ids = new Set(options.profile.models.map((model) => model.providerId));
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        agent: options.adapter.id,
        profile: options.profile,
        providers: options.providers.filter((provider) => ids.has(provider.id)),
        mode: options.mode,
        scope: options.scope,
        cwd: options.cwd ?? process.cwd(),
        files: preview.files.map((file) => file.path),
        config: options.adapter.buildConfig(options.profile, options.providers),
        env: options.adapter.buildEnv?.(options.profile, options.providers),
        mergeEnabled,
      }),
    )
    .digest('hex');
}
