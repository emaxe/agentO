import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../config/store.js';
import { ProviderSchema, type Provider } from '../config/schema.js';

export type CreateProviderInput = Omit<Provider, 'id'>;

/** Возвращает список всех провайдеров. */
export async function listProviders(): Promise<Provider[]> {
  const config = await readConfig();
  return config.providers;
}

/** Добавляет нового провайдера. Возвращает созданного провайдера. */
export async function addProvider(input: CreateProviderInput): Promise<Provider> {
  const config = await readConfig();
  const provider = ProviderSchema.parse({ ...input, id: randomUUID() });
  config.providers.push(provider);
  await writeConfig(config);
  return provider;
}

/** Обновляет провайдера по id. Выбрасывает Error если не найден. */
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

/** Удаляет провайдера по id или имени. Выбрасывает Error если не найден. */
export async function removeProvider(idOrName: string): Promise<void> {
  const config = await readConfig();
  const index = config.providers.findIndex(
    (p) => p.id === idOrName || p.name === idOrName,
  );
  if (index === -1) throw new Error(`Provider not found: ${idOrName}`);
  config.providers.splice(index, 1);
  await writeConfig(config);
}

/** Находит провайдера по id или имени. Возвращает undefined если не найден. */
export async function findProvider(idOrName: string): Promise<Provider | undefined> {
  const config = await readConfig();
  return config.providers.find((p) => p.id === idOrName || p.name === idOrName);
}
