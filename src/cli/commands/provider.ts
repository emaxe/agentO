import { Command } from 'commander';
import { listProviders, addProvider, removeProvider } from '../../providers/provider-manager.js';

export function createProviderCommand(): Command {
  const cmd = new Command('provider').description('Manage API providers');

  cmd
    .command('list')
    .description('List all providers')
    .action(async () => {
      try {
        const providers = await listProviders();
        if (providers.length === 0) {
          console.log('No providers configured.');
        } else {
          providers.forEach((p) => {
            const maskedKey = p.apiKey.slice(0, 8) + '...';
            console.log(`  ${p.name} (${p.type}) — key: ${maskedKey}${p.baseUrl ? `, url: ${p.baseUrl}` : ''}`);
            console.log(`    models: ${p.models.join(', ')}`);
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
    .description('Add a new provider')
    .requiredOption('-n, --name <name>', 'Provider name')
    .requiredOption('-t, --type <type>', 'Provider type (openai-compatible, anthropic, fireworks)')
    .requiredOption('-k, --api-key <key>', 'API key')
    .option('-u, --base-url <url>', 'Base URL (for openai-compatible)')
    .requiredOption('-M, --models <models>', 'Comma-separated list of model names')
    .action(async (opts: { name: string; type: string; apiKey: string; baseUrl?: string; models: string }) => {
      try {
        const models = opts.models.split(',').map((m) => m.trim()).filter(Boolean);
        const provider = await addProvider({
          name: opts.name,
          type: opts.type as 'openai-compatible' | 'anthropic' | 'fireworks',
          apiKey: opts.apiKey,
          baseUrl: opts.baseUrl,
          models,
        });
        console.log(`Provider "${provider.name}" added (id: ${provider.id})`);
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('remove <name>')
    .description('Remove a provider by name or id')
    .action(async (name: string) => {
      try {
        await removeProvider(name);
        console.log(`Provider "${name}" removed.`);
        process.exit(0);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
