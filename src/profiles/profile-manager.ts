import { randomUUID } from 'node:crypto';
import { readConfig, writeConfig } from '../config/store.js';
import { ProfileSchema, type Profile, type ProfileModel } from '../config/schema.js';

export type CreateProfileInput = Omit<Profile, 'id'>;

/** Returns all configured profiles. */
export async function listProfiles(): Promise<Profile[]> {
  const config = await readConfig();
  return config.profiles;
}

/**
 * Adds a new profile after validating against {@link ProfileSchema}.
 * Generates a UUID for the profile id.
 * @returns The newly created profile.
 */
export async function addProfile(input: CreateProfileInput): Promise<Profile> {
  const config = await readConfig();
  const profile = ProfileSchema.parse({ ...input, id: randomUUID() });
  config.profiles.push(profile);
  await writeConfig(config);
  return profile;
}

/**
 * Updates an existing profile by id.
 * @throws Error if the profile is not found.
 */
export async function updateProfile(
  id: string,
  updates: Partial<CreateProfileInput>,
): Promise<Profile> {
  const config = await readConfig();
  const index = config.profiles.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Profile not found: ${id}`);
  const updated = ProfileSchema.parse({ ...config.profiles[index], ...updates });
  config.profiles[index] = updated;
  await writeConfig(config);
  return updated;
}

/**
 * Removes a profile by id or name.
 * @throws Error if no matching profile is found.
 */
export async function removeProfile(idOrName: string): Promise<void> {
  const config = await readConfig();
  const index = config.profiles.findIndex(
    (p) => p.id === idOrName || p.name === idOrName,
  );
  if (index === -1) throw new Error(`Profile not found: ${idOrName}`);
  config.profiles.splice(index, 1);
  await writeConfig(config);
}

/**
 * Looks up a profile by id or name.
 * @returns The matched profile, or `undefined` if none found.
 */
export async function findProfile(idOrName: string): Promise<Profile | undefined> {
  const config = await readConfig();
  return config.profiles.find((p) => p.id === idOrName || p.name === idOrName);
}

/**
 * Moves a model earlier in the profile's model list (decreases its index).
 * @throws Error if the profile or index is invalid.
 */
export async function moveModelUp(profileId: string, modelIndex: number): Promise<Profile> {
  const config = await readConfig();
  const profile = config.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  if (modelIndex <= 0 || modelIndex >= profile.models.length) return profile;
  const models = [...profile.models];
  [models[modelIndex - 1], models[modelIndex]] = [models[modelIndex], models[modelIndex - 1]];
  const updated = ProfileSchema.parse({ ...profile, models });
  const index = config.profiles.findIndex((p) => p.id === profileId);
  config.profiles[index] = updated;
  await writeConfig(config);
  return updated;
}

/**
 * Moves a model later in the profile's model list (increases its index).
 * @throws Error if the profile or index is invalid.
 */
export async function moveModelDown(profileId: string, modelIndex: number): Promise<Profile> {
  const config = await readConfig();
  const profile = config.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  if (modelIndex < 0 || modelIndex >= profile.models.length - 1) return profile;
  const models = [...profile.models];
  [models[modelIndex], models[modelIndex + 1]] = [models[modelIndex + 1], models[modelIndex]];
  const updated = ProfileSchema.parse({ ...profile, models });
  const index = config.profiles.findIndex((p) => p.id === profileId);
  config.profiles[index] = updated;
  await writeConfig(config);
  return updated;
}
