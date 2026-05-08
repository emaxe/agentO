import { Command } from 'commander';
import { listProfiles, addProfile, removeProfile } from '../../profiles/profile-manager.js';

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
              console.log(`    ${i + 1}. provider: ${m.providerId}, model: ${m.model}`);
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
      'Comma-separated list of providerId:modelName pairs (e.g. uuid1:gpt-4,uuid2:claude-3)',
    )
    .action(async (opts: { name: string; models: string }) => {
      try {
        const models = opts.models
          .split(',')
          .map((pair) => {
            const [providerId, ...rest] = pair.trim().split(':');
            return { providerId: providerId ?? '', model: rest.join(':') };
          })
          .filter((m) => m.providerId && m.model);

        if (models.length === 0) {
          console.error('Error: No valid models provided. Format: providerId:modelName');
          process.exit(1);
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
