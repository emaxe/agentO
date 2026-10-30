/**
 * CLI command: `agento provider`
 *
 * Subcommands: list, add, edit, test, remove.
 */
import { Command } from 'commander';
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
} from '../../providers/provider-manager.js';
import { maskSecret } from '../../config/mask.js';
import {
  capabilityMarker,
  PROVIDER_TYPES,
  ProviderTypeSchema,
  type ModelConfig,
  type Provider,
  type ProviderType,
} from '../../config/schema.js';
import {
  fetchProviderModels,
  isOpenAICompatible,
  resolveModelsBaseUrl,
} from '../../tui/provider-api.js';

const DEFAULT_CAPABILITIES = { image: true, video: false, audio: false };

function parseModels(value: string): ModelConfig[] {
  return value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
    .map((name) => ({ name, capabilities: { ...DEFAULT_CAPABILITIES } }));
}

function parseProviderType(value: string): ProviderType {
  const parsed = ProviderTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid provider type: "${value}". Supported: ${PROVIDER_TYPES.join(', ')}`);
  }
  return parsed.data;
}

function parseCustomApiModes(value: string): {
  openai: boolean;
  anthropic: boolean;
  responses: boolean;
} {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('custom-api-modes must be a JSON object {openai,anthropic,responses}');
  }
  const modes = parsed as Record<string, unknown>;
  return {
    openai: modes.openai === true,
    anthropic: modes.anthropic === true,
    responses: modes.responses === true,
  };
}

function resolveProvider(providers: Provider[], ref: string): Provider {
  const lower = ref.toLowerCase();
  const provider = providers.find(
    (candidate) => candidate.id.toLowerCase() === lower || candidate.name.toLowerCase() === lower,
  );
  if (!provider) {
    throw new Error(`Provider not found: ${ref}. Use a name or id from "agento provider list".`);
  }
  return provider;
}

async function modelsFromApi(
  type: ProviderType,
  baseUrl: string | undefined,
  apiKey: string,
): Promise<ModelConfig[]> {
  if (!isOpenAICompatible(type)) {
    throw new Error(
      `Provider type "${type}" does not expose an OpenAI-compatible /models endpoint. Pass -M instead.`,
    );
  }
  const result = await fetchProviderModels(resolveModelsBaseUrl(type, baseUrl ?? ''), apiKey);
  if (!result.ok) throw new Error(result.error);
  if (result.models.length === 0) throw new Error('The API returned no models.');
  return result.models.map((name) => ({ name, capabilities: { ...DEFAULT_CAPABILITIES } }));
}

/** Builds the `provider` CLI command. */
export function createProviderCommand(): Command {
  const cmd = new Command('provider').description('Manage API providers');

  cmd
    .command('list')
    .description('List all providers')
    .option('--json', 'Output JSON (API keys are masked)')
    .action(async (opts: { json?: boolean }) => {
      try {
        const providers = await listProviders();
        if (opts.json) {
          console.log(
            JSON.stringify(
              providers.map((provider) => ({
                ...provider,
                apiKey: maskSecret(provider.apiKey),
              })),
              null,
              2,
            ),
          );
        } else if (providers.length === 0) {
          console.log('No providers configured.');
        } else {
          providers.forEach((p) => {
            const maskedKey = maskSecret(p.apiKey);
            console.log(
              `  ${p.name} (${p.type}, id: ${p.id}) — key: ${maskedKey}${p.baseUrl ? `, url: ${p.baseUrl}` : ''}`,
            );
            console.log(
              `    models: ${p.models.map((m) => `${capabilityMarker(m.capabilities)} ${m.name}`).join(', ')}`,
            );
          });
        }
        // Let stdout flush before the process exits; process.exit(0) here
        // truncated large --json documents when stdout was a pipe.
        process.exitCode = 0;
        return;
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new provider')
    .requiredOption('-n, --name <name>', 'Provider name')
    .requiredOption('-t, --type <type>', `Provider type (${PROVIDER_TYPES.join(', ')})`)
    .requiredOption('-k, --api-key <key>', 'API key')
    .option(
      '-u, --base-url <url>',
      'Base URL (for openai-compatible, responses-compatible, custom-api). For custom-api trailing /v1/ is stripped automatically',
    )
    .option(
      '-c, --custom-api-modes <json>',
      'JSON object with boolean flags {openai,anthropic,responses} (required for custom-api type)',
    )
    .option('-M, --models <models>', 'Comma-separated list of model names')
    .option(
      '--fetch-models',
      'Fetch the model list from the provider /models endpoint (instead of -M)',
    )
    .action(
      async (opts: {
        name: string;
        type: string;
        apiKey: string;
        baseUrl?: string;
        customApiModes?: string;
        models?: string;
        fetchModels?: boolean;
      }) => {
        try {
          const type = parseProviderType(opts.type);
          const models = opts.fetchModels
            ? await modelsFromApi(type, opts.baseUrl, opts.apiKey)
            : opts.models
              ? parseModels(opts.models)
              : [];
          if (models.length === 0) {
            throw new Error('Provide -M <models> or --fetch-models.');
          }
          const customApiModes = opts.customApiModes
            ? parseCustomApiModes(opts.customApiModes)
            : undefined;
          const provider = await addProvider({
            name: opts.name,
            type,
            apiKey: opts.apiKey,
            baseUrl: opts.baseUrl,
            customApiModes,
            models,
          });
          console.log(`Provider "${provider.name}" added (id: ${provider.id})`);
          process.exitCode = 0;
          return;
        } catch (err) {
          console.error('Error:', err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  cmd
    .command('edit <name>')
    .description('Edit an existing provider by name or id')
    .option('-n, --name <name>', 'New provider name')
    .option('-t, --type <type>', `New provider type (${PROVIDER_TYPES.join(', ')})`)
    .option('-k, --api-key <key>', 'New API key')
    .option('-u, --base-url <url>', 'New base URL')
    .option('-c, --custom-api-modes <json>', 'New custom-api modes')
    .option('-M, --models <models>', 'Replace the model list (comma-separated)')
    .option('--fetch-models', 'Replace the model list with the provider /models response')
    .action(
      async (
        name: string,
        opts: {
          name?: string;
          type?: string;
          apiKey?: string;
          baseUrl?: string;
          customApiModes?: string;
          models?: string;
          fetchModels?: boolean;
        },
      ) => {
        try {
          const providers = await listProviders();
          const provider = resolveProvider(providers, name);
          const type = opts.type ? parseProviderType(opts.type) : provider.type;
          const baseUrl = opts.baseUrl ?? provider.baseUrl;
          const apiKey = opts.apiKey ?? provider.apiKey;

          let models: ModelConfig[] | undefined;
          if (opts.fetchModels) {
            models = await modelsFromApi(type, baseUrl, apiKey);
          } else if (opts.models) {
            models = parseModels(opts.models);
          }

          const updates = {
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.type !== undefined ? { type } : {}),
            ...(opts.apiKey !== undefined ? { apiKey } : {}),
            ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
            ...(opts.customApiModes !== undefined
              ? { customApiModes: parseCustomApiModes(opts.customApiModes) }
              : {}),
            ...(models !== undefined ? { models } : {}),
          };
          if (Object.keys(updates).length === 0) {
            throw new Error('Nothing to update. Pass at least one option.');
          }

          const updated = await updateProvider(provider.id, updates);
          console.log(`Provider "${updated.name}" updated (id: ${updated.id})`);
          process.exitCode = 0;
          return;
        } catch (err) {
          console.error('Error:', err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      },
    );

  cmd
    .command('test <name>')
    .description('Test a provider by fetching its /models endpoint')
    .option('--json', 'Output JSON')
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const providers = await listProviders();
        const provider = resolveProvider(providers, name);
        if (!isOpenAICompatible(provider.type)) {
          throw new Error(
            `Provider type "${provider.type}" does not expose an OpenAI-compatible /models endpoint.`,
          );
        }
        const result = await fetchProviderModels(
          resolveModelsBaseUrl(provider.type, provider.baseUrl ?? ''),
          provider.apiKey,
        );
        if (opts.json) {
          console.log(JSON.stringify(result));
        } else if (result.ok) {
          console.log(`OK — ${result.models.length} models from "${provider.name}"`);
          for (const model of result.models) console.log(`  ${model}`);
        } else {
          console.error(`Error: ${result.error}`);
        }
        process.exitCode = result.ok ? 0 : 1;
        return;
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
        process.exitCode = 0;
        return;
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}
