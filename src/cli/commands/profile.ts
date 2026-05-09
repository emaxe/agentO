import { Command } from 'commander';
import { listProfiles, addProfile, removeProfile } from '../../profiles/profile-manager.js';
import type { ModelTier, ProfileModel } from '../../config/schema.js';

const VALID_TIERS: ModelTier[] = ['small', 'base', 'smart'];

export function createProfileCommand(): Command {
  const cmd = new Command('profile').description('Manage profiles');

  cmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      try {
        const profiles = await listProfiles();
        if (profiles.length === 0) {
          console.log('No profiles configured.');
        } else {
          profiles.forEach((p) => {
            console.log(`  ${p.name} (id: ${p.id})`);
            p.models.forEach((m, i) => {
              const tierStr = m.tier ? ` [${m.tier}]` : '';
              console.log(`    ${i + 1}. provider: ${m.providerId}, model: ${m.model}${tierStr}`);
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
      'Comma-separated list of providerId:modelName[:tier] (tier ∈ small|base|smart, optional). Tier is only meaningful when there are multiple models.',
    )
    .action(async (opts: { name: string; models: string }) => {
      try {
        const models: ProfileModel[] = [];
        for (const raw of opts.models.split(',')) {
          const parts = raw.trim().split(':');
          if (parts.length < 2) continue;
          const providerId = parts[0]!;
          // Последний сегмент может быть tier; иначе всё после providerId — модель.
          const last = parts[parts.length - 1]!;
          let model: string;
          let tier: ModelTier | undefined;
          if (parts.length >= 3 && (VALID_TIERS as string[]).includes(last)) {
            tier = last as ModelTier;
            model = parts.slice(1, -1).join(':');
          } else {
            model = parts.slice(1).join(':');
          }
          if (!providerId || !model) continue;
          models.push(tier ? { providerId, model, tier } : { providerId, model });
        }

        if (models.length === 0) {
          console.error('Error: No valid models provided. Format: providerId:modelName[:tier]');
          process.exit(1);
        }

        if (models.length > 1) {
          if (models.some((m) => !m.tier)) {
            console.error('Error: with multiple models every entry must include a tier (small|base|smart)');
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
