/**
 * CLI command: `agento profile`
 *
 * Subcommands: list, add, remove.
 */
import { Command } from 'commander';
import { listProfiles, addProfile, removeProfile } from '../../profiles/profile-manager.js';
import { listProviders } from '../../providers/provider-manager.js';
import type { ModelTier, ProfileModel, Provider } from '../../config/schema.js';

const VALID_TIERS: ModelTier[] = ['small', 'base', 'smart'];

/**
 * Resolve a provider reference (name, case-insensitive, or UUID) to its id.
 * Lets `agento profile add -m Acme:gpt` use the friendly name instead of a UUID.
 */
function resolveProviderId(ref: string, providers: Provider[]): string | null {
  const lower = ref.toLowerCase();
  const byId = providers.find((p) => p.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const byName = providers.find((p) => p.name.toLowerCase() === lower);
  return byName ? byName.id : null;
}

/** Builds the `profile` CLI command. */
export function createProfileCommand(): Command {
  const cmd = new Command('profile').description('Manage profiles');

  cmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      try {
        const profiles = await listProfiles();
        const providers = await listProviders();
        const nameOf = (id: string): string => providers.find((p) => p.id === id)?.name ?? id;
        if (profiles.length === 0) {
          console.log('No profiles configured.');
        } else {
          profiles.forEach((p) => {
            console.log(`  ${p.name} (id: ${p.id})`);
            p.models.forEach((m, i) => {
              const tierStr = m.tier ? ` [${m.tier}]` : '';
              console.log(
                `    ${i + 1}. provider: ${nameOf(m.providerId)}, model: ${m.model}${tierStr}`,
              );
            });
          });
        }
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new profile')
    .requiredOption('-n, --name <name>', 'Profile name')
    .requiredOption(
      '-m, --models <models>',
      'Comma-separated list of providerName:modelName[:tier] (provider name or UUID; tier ∈ small|base|smart, optional). Tier is only meaningful when there are multiple models.',
    )
    .action(async (opts: { name: string; models: string }) => {
      try {
        const providers = await listProviders();
        const models: ProfileModel[] = [];
        for (const raw of opts.models.split(',')) {
          const parts = raw.trim().split(':');
          if (parts.length < 2) continue;
          const providerRef = parts[0]!;
          // Последний сегмент может быть tier; иначе всё после provider — модель.
          const last = parts[parts.length - 1]!;
          let model: string;
          let tier: ModelTier | undefined;
          if (parts.length >= 3 && (VALID_TIERS as string[]).includes(last)) {
            tier = last as ModelTier;
            model = parts.slice(1, -1).join(':');
          } else {
            model = parts.slice(1).join(':');
          }
          if (!providerRef || !model) continue;
          const providerId = resolveProviderId(providerRef, providers);
          if (!providerId) {
            console.error(
              `Error: Unknown provider "${providerRef}". ` +
                `Use a provider name or id from "agento provider list".`,
            );
            process.exit(1);
            return;
          }
          models.push(tier ? { providerId, model, tier } : { providerId, model });
        }

        if (models.length === 0) {
          console.error('Error: No valid models provided. Format: providerId:modelName[:tier]');
          process.exit(1);
        }

        // All models in a profile must belong to the same provider
        const firstProviderId = models[0]!.providerId;
        for (const m of models) {
          if (m.providerId !== firstProviderId) {
            console.error(
              `Error: all models in a profile must belong to the same provider. ` +
                `Conflicting model "${m.model}" uses provider "${m.providerId}" instead of "${firstProviderId}".`,
            );
            process.exit(1);
          }
        }

        if (models.length > 1) {
          if (models.some((m) => !m.tier)) {
            console.error(
              'Error: with multiple models every entry must include a tier (small|base|smart)',
            );
            process.exit(1);
          }
          if (!models.some((m) => m.tier === 'base')) {
            console.error('Error: at least one model must have tier=base');
            process.exit(1);
          }
        } else {
          // Одна модель: tier игнорируется.
          delete models[0]!.tier;
        }

        const profile = await addProfile({ name: opts.name, models });
        console.log(`Profile "${profile.name}" added (id: ${profile.id})`);
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('remove <name>')
    .description('Remove a profile by name or id')
    .action(async (name: string) => {
      try {
        await removeProfile(name);
        console.log(`Profile "${name}" removed.`);
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
