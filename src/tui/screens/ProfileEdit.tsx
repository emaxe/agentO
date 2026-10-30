import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { sanitizeFieldValue } from '../sanitize-field-value.js';
import { useKeyInput } from '../use-key-input.js';
import { SelectList } from '../components/SelectList.js';
import type { Profile, Provider, ProfileModel } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';
import { validateProfile } from '../../config/validation.js';
import { defaultTierCursor, tierOptions, usedTiersOf } from '../tier-options.js';

type EditSubStep = 'select-provider' | 'select-model' | 'select-tier';

interface ProfileEditProps {
  profile: Profile;
  providers: Provider[];
  profiles: Profile[];
  onSave: (result: { name: string; models: ProfileModel[] }) => void;
  onCancel: () => void;
  startAddingModel?: boolean;
}

export function ProfileEdit({
  profile,
  providers,
  profiles,
  onSave,
  onCancel,
  startAddingModel = false,
}: ProfileEditProps): React.JSX.Element {
  const [editName, setEditName] = useState(profile.name);
  const [editModels, setEditModels] = useState<ProfileModel[]>([...profile.models]);
  const [editModelCursor, setEditModelCursor] = useState(
    startAddingModel ? profile.models.length : 0,
  );
  const [editFocus, setEditFocus] = useState<'name' | 'models' | 'save'>(
    startAddingModel ? 'models' : 'name',
  );
  const initialUntieredIndex = startAddingModel
    ? profile.models.findIndex((model) => !model.tier)
    : -1;
  const initialTierOptions =
    initialUntieredIndex >= 0
      ? tierOptions(
          usedTiersOf(profile.models.filter((_, index) => index !== initialUntieredIndex)),
          false,
        )
      : [];
  const [editSubStep, setEditSubStep] = useState<EditSubStep | null>(
    startAddingModel
      ? initialUntieredIndex >= 0
        ? 'select-tier'
        : profile.models.length > 0
          ? 'select-model'
          : 'select-provider'
      : null,
  );
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(
    startAddingModel && profile.models.length > 0 ? profile.models[0]!.providerId : null,
  );
  const [providerCursor, setProviderCursor] = useState(0);
  const [modelCursor, setModelCursor] = useState(0);
  const [customModel, setCustomModel] = useState('');
  const [pendingModel, setPendingModel] = useState('');
  const [tierCursor, setTierCursor] = useState(
    initialTierOptions.length > 0 ? defaultTierCursor(initialTierOptions) : 1,
  );
  const [tierTargetIndex, setTierTargetIndex] = useState<number | null>(
    initialUntieredIndex >= 0 ? initialUntieredIndex : null,
  );
  const [status, setStatus] = useState('');
  const [confirmEmptyModels, setConfirmEmptyModels] = useState(false);
  const canAddModel = editModels.length < 3;
  const firstUntieredModel = editModels.findIndex((model) => !model.tier);

  const doSave = useCallback(() => {
    const trimmedName = editName.trim();
    const modelsToSave: ProfileModel[] =
      editModels.length === 1
        ? [{ providerId: editModels[0]!.providerId, model: editModels[0]!.model }]
        : editModels;

    // Check for empty models
    if (modelsToSave.length === 0) {
      setConfirmEmptyModels(true);
      return;
    }

    try {
      validateProfile({ name: trimmedName, models: modelsToSave }, profiles, providers, profile.id);
      onSave({ name: trimmedName, models: modelsToSave });
    } catch (err) {
      setStatus(String(err));
    }
  }, [editName, editModels, profiles, providers, profile, onSave]);

  useKeyInput((input, key) => {
    if (confirmEmptyModels) {
      const lower = input.toLowerCase();
      if (key.return || lower === 'y') {
        setConfirmEmptyModels(false);
        // Signal to parent that profile should be deleted
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSave({ name: editName.trim(), models: [], _deleteProfile: true } as any);
        return;
      }
      if (lower === 'n' || key.escape) {
        setConfirmEmptyModels(false);
        return;
      }
      return;
    }

    if (editSubStep !== null) {
      if (key.escape) {
        if (editSubStep === 'select-provider') {
          setEditSubStep(null);
          return;
        }
        if (editSubStep === 'select-model') {
          setEditSubStep('select-provider');
          return;
        }
        if (editSubStep === 'select-tier') {
          if (tierTargetIndex !== null) {
            setTierTargetIndex(null);
            setEditSubStep(null);
            return;
          }
          setEditSubStep('select-model');
          return;
        }
        return;
      }
      if (editSubStep === 'select-provider') {
        const firstProviderId = editModels[0]?.providerId;
        const availableProviders = firstProviderId
          ? providers.filter((p) => p.id === firstProviderId)
          : providers;
        if (key.upArrow) {
          setProviderCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setProviderCursor((i) => Math.min(availableProviders.length - 1, i + 1));
          return;
        }
        if (key.return && availableProviders[providerCursor]) {
          setPendingProviderId(availableProviders[providerCursor].id);
          setModelCursor(0);
          setCustomModel('');
          setEditSubStep('select-model');
        }
        return;
      }
      if (editSubStep === 'select-model') {
        const provider = providers.find((p) => p.id === pendingProviderId);
        if (!provider) {
          setEditSubStep('select-provider');
          return;
        }
        const total = provider.models.length + 1;
        if (key.upArrow) {
          setModelCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setModelCursor((i) => Math.min(total - 1, i + 1));
          return;
        }
        if (key.return) {
          let chosen: string | null = null;
          if (modelCursor < provider.models.length) {
            chosen = provider.models[modelCursor]?.name ?? null;
          } else {
            const trimmed = customModel.trim();
            if (!trimmed) {
              setStatus('Enter custom model name');
              return;
            }
            chosen = trimmed;
          }
          if (!chosen) return;
          setStatus('');
          setPendingModel(chosen);
          const usedTiers = usedTiersOf(editModels);
          setTierCursor(defaultTierCursor(tierOptions(usedTiers, editModels.length === 0)));
          setEditSubStep('select-tier');
        }
        return;
      }
      if (editSubStep === 'select-tier') {
        const targetModel = tierTargetIndex !== null ? editModels[tierTargetIndex] : undefined;
        const otherModels =
          tierTargetIndex !== null
            ? editModels.filter((_, index) => index !== tierTargetIndex)
            : editModels;
        const options = tierOptions(
          usedTiersOf(otherModels),
          targetModel ? false : editModels.length === 0,
        );
        const optionsCount = options.length;
        if (key.upArrow) {
          setTierCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setTierCursor((i) => Math.min(optionsCount - 1, i + 1));
          return;
        }
        if (key.return) {
          const option = options[tierCursor];
          if (!option) {
            setEditSubStep(targetModel ? null : 'select-model');
            return;
          }
          if (targetModel && tierTargetIndex !== null) {
            if (!option.tier) {
              setStatus('Choose a tier for this model.');
              return;
            }
            setEditModels((prev) =>
              prev.map((model, index) =>
                index === tierTargetIndex ? { ...model, tier: option.tier } : model,
              ),
            );
            setTierTargetIndex(null);
            setStatus('');
            // Continue with the "add model" action that triggered this.
            setPendingProviderId(targetModel.providerId);
            setModelCursor(0);
            setCustomModel('');
            setEditSubStep('select-model');
            return;
          }
          const provider = providers.find((p) => p.id === pendingProviderId);
          if (!provider || !pendingModel) {
            setEditSubStep('select-provider');
            return;
          }
          setEditModels((prev) => [
            ...prev,
            {
              providerId: provider.id,
              model: pendingModel,
              ...(option.tier ? { tier: option.tier } : {}),
            },
          ]);
          setPendingModel('');
          setEditSubStep(null);
        }
        return;
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      const focusOrder: ('name' | 'models' | 'save')[] = ['name', 'models', 'save'];
      const currentIdx = focusOrder.indexOf(editFocus);
      const nextFocus = focusOrder[(currentIdx + 1) % focusOrder.length]!;
      setEditFocus(nextFocus);
      setStatus('');
      return;
    }
    if (input === 's') {
      if (editFocus === 'save') {
        doSave();
        return;
      }
      setEditFocus('save');
      return;
    }
    if (key.return && editFocus === 'save') {
      doSave();
      return;
    }

    if (editFocus === 'name') {
      if (key.return) {
        setEditFocus('models');
        return;
      }
      return; // TextInput handles text input
    }

    if (editFocus === 'models') {
      const total = canAddModel ? editModels.length + 1 : editModels.length;
      if (key.pageDown) {
        setEditModelCursor((i) => Math.min(total - 1, i + 12));
        return;
      }
      if (key.pageUp) {
        setEditModelCursor((i) => Math.max(0, i - 12));
        return;
      }
      if (key.upArrow && !key.shift) {
        setEditModelCursor((i) => Math.max(0, i - 1));
      } else if (key.downArrow && !key.shift) {
        setEditModelCursor((i) => Math.min(total - 1, i + 1));
      } else if (
        key.shift &&
        key.upArrow &&
        editModelCursor > 0 &&
        editModelCursor < editModels.length
      ) {
        setEditModels((prev) => {
          const arr = [...prev];
          [arr[editModelCursor - 1], arr[editModelCursor]] = [
            arr[editModelCursor]!,
            arr[editModelCursor - 1]!,
          ];
          return arr;
        });
        setEditModelCursor((i) => i - 1);
      } else if (key.shift && key.downArrow && editModelCursor < editModels.length - 1) {
        setEditModels((prev) => {
          const arr = [...prev];
          [arr[editModelCursor], arr[editModelCursor + 1]] = [
            arr[editModelCursor + 1]!,
            arr[editModelCursor]!,
          ];
          return arr;
        });
        setEditModelCursor((i) => i + 1);
      } else if (input === 'd' && editFocus === 'models' && editModelCursor < editModels.length) {
        setEditModels((prev) => prev.filter((_, i) => i !== editModelCursor));
        setEditModelCursor((i) => Math.max(0, i - 1));
        setStatus('');
      } else if (key.return && editModelCursor === editModels.length) {
        if (!canAddModel) {
          setStatus('Maximum 3 models (one per tier)');
          return;
        }
        if (firstUntieredModel >= 0) {
          // "No tier" is only valid for a single-model profile. Assign a tier to
          // the existing model before adding a second one, or the save can never
          // pass validateProfile.
          setTierTargetIndex(firstUntieredModel);
          setTierCursor(
            defaultTierCursor(
              tierOptions(
                usedTiersOf(editModels.filter((_, index) => index !== firstUntieredModel)),
                false,
              ),
            ),
          );
          setStatus(
            `Assign a tier to "${editModels[firstUntieredModel]!.model}" before adding another model.`,
          );
          setEditSubStep('select-tier');
          return;
        }
        if (editModels.length > 0) {
          // Skip provider selection if profile already has models
          setPendingProviderId(editModels[0]!.providerId);
          setModelCursor(0);
          setCustomModel('');
          setEditSubStep('select-model');
        } else {
          setProviderCursor(0);
          setModelCursor(0);
          setCustomModel('');
          setEditSubStep('select-provider');
        }
      }
    }
  });

  if (confirmEmptyModels) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          ⚠ Profile has no models
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Cannot save profile without at least one model.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Delete this profile permanently? y/Enter: confirm | n/Esc: cancel</Text>
        </Box>
        {status && (
          <Box marginTop={1}>
            <Text color="yellow">{status}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (editSubStep !== null) {
    const subTitle =
      editSubStep === 'select-provider'
        ? 'Select provider'
        : editSubStep === 'select-model'
          ? 'Select model'
          : 'Assign tier';
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Edit Profile — {subTitle}</Text>
        <Text dimColor>Esc: back</Text>

        {editSubStep === 'select-provider' &&
          (() => {
            // Lock provider to the existing one if profile already has models
            const firstProviderId = editModels[0]?.providerId;
            const availableProviders = firstProviderId
              ? providers.filter((p) => p.id === firstProviderId)
              : providers;
            return (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>↑↓: navigate | Enter: select</Text>
                {firstProviderId && availableProviders.length === 1 && (
                  <Text dimColor>Provider locked to: {availableProviders[0]?.name ?? '?'}</Text>
                )}
                <SelectList
                  items={availableProviders}
                  selected={providerCursor}
                  title={firstProviderId ? 'Provider (locked to existing):' : 'Select provider:'}
                  renderItem={(p, i, isSelected) => (
                    <Text color={isSelected ? 'green' : undefined}>
                      {isSelected ? '▶ ' : '  '}
                      {p.name} ({p.type}, {p.models.length} models)
                    </Text>
                  )}
                />
              </Box>
            );
          })()}

        {editSubStep === 'select-model' &&
          (() => {
            const provider = providers.find((p) => p.id === pendingProviderId);
            if (!provider) return <></>;
            const customIdx = provider.models.length;
            return (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>↑↓: navigate | Enter: select</Text>
                <Box marginTop={1}>
                  <Text>
                    Provider: <Text color="cyan">{provider.name}</Text>
                  </Text>
                </Box>
                <Box flexDirection="column" marginTop={1}>
                  {provider.models.map((m, i) => (
                    <Text key={m.name} color={i === modelCursor ? 'green' : undefined}>
                      {i === modelCursor ? '▶ ' : '  '}
                      <Text color="gray">{capabilityMarker(m.capabilities)} </Text>
                      {m.name}
                    </Text>
                  ))}
                  <Box>
                    <Text color={modelCursor === customIdx ? 'green' : 'cyan'}>
                      {modelCursor === customIdx ? '▶ ' : '  '}[custom]:{' '}
                    </Text>
                    <TextInput
                      value={customModel}
                      onChange={(v) => setCustomModel(sanitizeFieldValue(v))}
                      focus={modelCursor === customIdx}
                      showCursor={modelCursor === customIdx}
                      placeholder="model-name"
                    />
                  </Box>
                </Box>
              </Box>
            );
          })()}

        {editSubStep === 'select-tier' &&
          (() => {
            const targetModel = tierTargetIndex !== null ? editModels[tierTargetIndex] : undefined;
            const provider = providers.find(
              (p) => p.id === (targetModel?.providerId ?? pendingProviderId),
            );
            const otherModels =
              tierTargetIndex !== null
                ? editModels.filter((_, index) => index !== tierTargetIndex)
                : editModels;
            const usedTiers = usedTiersOf(otherModels);
            const options = tierOptions(usedTiers, targetModel ? false : editModels.length === 0);
            const needsBase = !usedTiers.has('base') && otherModels.length > 0;
            return (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>↑↓: navigate | Enter: confirm</Text>
                <Box marginTop={1}>
                  <Text>
                    Model: <Text color="cyan">{targetModel?.model ?? pendingModel}</Text> (
                    {provider?.name ?? '?'})
                  </Text>
                </Box>
                {targetModel && (
                  <Text color="yellow">
                    Already in this profile — assign a tier before adding another model.
                  </Text>
                )}
                <Box flexDirection="column" marginTop={1}>
                  {options.map((option, i) => (
                    <Text key={option.label} color={i === tierCursor ? 'green' : undefined}>
                      {i === tierCursor ? '▶ ' : '  '}
                      {option.label}
                    </Text>
                  ))}
                </Box>
                {needsBase && (
                  <Text color="yellow">A multi-model profile must include one base tier.</Text>
                )}
              </Box>
            );
          })()}

        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Edit Profile</Text>
      <Text dimColor>Tab: navigate (now: {editFocus}) | Esc: cancel</Text>
      <Box marginTop={1}>
        <Text color={editFocus === 'name' ? 'green' : undefined}>
          {editFocus === 'name' ? '▶ ' : '  '}Name:{' '}
        </Text>
        <TextInput
          value={editName}
          onChange={(v) => setEditName(sanitizeFieldValue(v))}
          focus={editFocus === 'name'}
          showCursor={editFocus === 'name'}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          Models
          {editFocus === 'models'
            ? ' (↑↓ navigate | Shift+↑↓ reorder | d: delete model | Enter on [+]: add)'
            : ''}
          :
        </Text>
        {(() => {
          const viewport = 12;
          const anchor = Math.min(editModelCursor, Math.max(0, editModels.length - 1));
          const start = Math.max(
            0,
            Math.min(anchor - Math.floor(viewport / 2), editModels.length - viewport),
          );
          const end = Math.min(editModels.length, start + viewport);
          return (
            <>
              {start > 0 && <Text dimColor> ↑ {start} more</Text>}
              {editModels.slice(start, end).map((m, rel) => {
                const i = start + rel;
                const p = providers.find((pr) => pr.id === m.providerId);
                const focused = editFocus === 'models' && i === editModelCursor;
                return (
                  <Text key={i} color={focused ? 'green' : undefined}>
                    {focused ? '▶ ' : '  '}
                    {m.model}
                    {m.tier ? ` [${m.tier}]` : ''} (provider:{' '}
                    {p?.name ?? m.providerId.slice(0, 8) + '...'})
                  </Text>
                );
              })}
              {end < editModels.length && <Text dimColor> ↓ {editModels.length - end} more</Text>}
            </>
          );
        })()}
        {firstUntieredModel >= 0 && editModels.length === 1 && (
          <Text dimColor>
            Single-model profile (no tier). Adding another model will ask for a tier.
          </Text>
        )}
        {canAddModel ? (
          <Text
            color="cyan"
            dimColor={!(editFocus === 'models' && editModelCursor === editModels.length)}
          >
            {editFocus === 'models' && editModelCursor === editModels.length ? '▶ ' : '  '}[+ add
            model]
          </Text>
        ) : (
          <Text dimColor>Maximum 3 models (one per tier).</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" bold={editFocus === 'save'}>
          {editFocus === 'save' ? '▶ ' : '  '}[S] Save Profile
        </Text>
      </Box>
      {status && <Text color="yellow">{status}</Text>}
    </Box>
  );
}
