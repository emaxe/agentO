/**
 * High-level CRUD operations for API providers.
 *
 * All functions read and write the central `~/.agento/config.json` via
 * {@link readConfig} / {@link writeConfig} so that every change is persisted
 * immediately.
 */
import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../config/store.js';
import { ProviderSchema, type Provider } from '../config/schema.js';

export type CreateProviderInput = Omit<Provider, 'id'>;

/** Returns all configured providers. */
export async function listProviders(): Promise<Provider[]> {
  const config = await readConfig();
  return config.providers;
}

/**
 * Adds a new provider after validating the input against {@link ProviderSchema}.
 * Generates a UUID for the provider id.
 * @returns The newly created provider.
 */
export async function addProvider(input: CreateProviderInput): Promise<Provider> {
  const config = await readConfig();
  const provider = ProviderSchema.parse({ ...input, id: randomUUID() });
  config.providers.push(provider);
  await writeConfig(config);
  return provider;
}

/**
 * Updates an existing provider by id.
 * @throws Error if the provider is not found.
 */
export async function updateProvider(
  id: string,
  updates: Partial<CreateProviderInput>,
): Promise<Provider> {
  const config = await readConfig();
  const index = config.providers.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Provider not found: ${id}`);
  const updated = ProviderSchema.parse({ ...config.providers[index], ...updates });
  config.providers[index] = updated;
  await writeConfig(config);
  return updated;
}

/**
 * Removes a provider by id or name.
 * @throws Error if no matching provider is found.
 */
export async function removeProvider(idOrName: string): Promise<void> {
  const config = await readConfig();
  const index = config.providers.findIndex(
    (p) => p.id === idOrName || p.name === idOrName,
  );
  if (index === -1) throw new Error(`Provider not found: ${idOrName}`);
  config.providers.splice(index, 1);
  await writeConfig(config);
}

/**
 * Looks up a provider by id or name.
 * @returns The matched provider, or `undefined` if none found.
 */
export async function findProvider(idOrName: string): Promise<Provider | undefined> {
  const config = await readConfig();
  return config.providers.find((p) => p.id === idOrName || p.name === idOrName);
}
