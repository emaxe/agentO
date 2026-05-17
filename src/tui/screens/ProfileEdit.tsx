import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeyInput } from '../use-key-input.js';
import { SelectList } from '../components/SelectList.js';
import type { Profile, Provider, ProfileModel, ModelTier } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';
import { validateProfile } from '../../config/validation.js';

const TIERS: ModelTier[] = ['small', 'base', 'smart'];
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
  const [editModelCursor, setEditModelCursor] = useState(startAddingModel ? profile.models.length : 0);
  const [editFocus, setEditFocus] = useState<'name' | 'models' | 'save'>(startAddingModel ? 'models' : 'name');
  const [editSubStep, setEditSubStep] = useState<EditSubStep | null>(
    startAddingModel ? (profile.models.length > 0 ? 'select-model' : 'select-provider') : null,
  );
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(
    startAddingModel && profile.models.length > 0 ? profile.models[0]!.providerId : null,
  );
  const [providerCursor, setProviderCursor] = useState(0);
  const [modelCursor, setModelCursor] = useState(0);
  const [customModel, setCustomModel] = useState('');
  const [pendingModel, setPendingModel] = useState('');
  const [tierCursor, setTierCursor] = useState(1);
  const [status, setStatus] = useState('');
  const [confirmEmptyModels, setConfirmEmptyModels] = useState(false);

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
      if (input === 'y') {
        setConfirmEmptyModels(false);
        // Signal to parent that profile should be deleted
        onSave({ name: editName.trim(), models: [], _deleteProfile: true } as any);
        return;
      }
      if (input === 'n' || key.escape) {
        setConfirmEmptyModels(false);
        return;
      }
      return;
    }

    if (editSubStep !== null) {
      if (key.escape) {
        if (editSubStep === 'select-provider') { setEditSubStep(null); return; }
        if (editSubStep === 'select-model') { setEditSubStep('select-provider'); return; }
        if (editSubStep === 'select-tier') { setEditSubStep('select-model'); return; }
        return;
      }
      if (editSubStep === 'select-provider') {
        const firstProviderId = editModels[0]?.providerId;
        const availableProviders = firstProviderId
          ? providers.filter((p) => p.id === firstProviderId)
          : providers;
        if (key.upArrow) { setProviderCursor((i) => Math.max(0, i - 1)); return; }
        if (key.downArrow) { setProviderCursor((i) => Math.min(availableProviders.length - 1, i + 1)); return; }
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
        if (!provider) { setEditSubStep('select-provider'); return; }
        const total = provider.models.length + 1;
        if (key.upArrow) { setModelCursor((i) => Math.max(0, i - 1)); return; }
        if (key.downArrow) { setModelCursor((i) => Math.min(total - 1, i + 1)); return; }
        if (key.return) {
          let chosen: string | null = null;
          if (modelCursor < provider.models.length) {
            chosen = provider.models[modelCursor]?.name ?? null;
          } else {
            const trimmed = customModel.trim();
            if (!trimmed) { setStatus('Enter custom model name'); return; }
            chosen = trimmed;
          }
          if (!chosen) return;
          setStatus('');
          setPendingModel(chosen);
          const usedTiers = new Set(editModels.map((m) => m.tier).filter(Boolean));
          const defaultIdx = TIERS.findIndex((t) => !usedTiers.has(t));
          setTierCursor(defaultIdx === -1 ? 1 : defaultIdx);
          setEditSubStep('select-tier');
        }
        return;
      }
      if (editSubStep === 'select-tier') {
        const optionsCount = 4;
        if (key.upArrow) { setTierCursor((i) => Math.max(0, i - 1)); return; }
        if (key.downArrow) { setTierCursor((i) => Math.min(optionsCount - 1, i + 1)); return; }
        if (key.return) {
          const provider = providers.find((p) => p.id === pendingProviderId);
          if (!provider || !pendingModel) { setEditSubStep('select-provider'); return; }
          const tier = tierCursor < 3 ? TIERS[tierCursor] : undefined;
          setEditModels((prev) => [...prev, { providerId: provider.id, model: pendingModel, tier }]);
          setPendingModel('');
          setEditSubStep(null);
        }
        return;
      }
      return;
    }

    if (key.escape) { onCancel(); return; }
    if (key.tab) {
      const focusOrder: ('name' | 'models' | 'save')[] = ['name', 'models', 'save'];
      const currentIdx = focusOrder.indexOf(editFocus);
      const nextFocus = focusOrder[(currentIdx + 1) % focusOrder.length]!;
      setEditFocus(nextFocus);
      return;
    }
    if (input === 's') {
      if (editFocus === 'save') { doSave(); return; }
      setEditFocus('save');
      return;
    }
    if (key.return && editFocus === 'save') { doSave(); return; }

    if (editFocus === 'name') {
      if (key.return) { setEditFocus('models'); return; }
      return; // TextInput handles text input
    }

    if (editFocus === 'models') {
      const total = editModels.length + 1;
      if (key.upArrow && !key.shift) {
        setEditModelCursor((i) => Math.max(0, i - 1));
      } else if (key.downArrow && !key.shift) {
        setEditModelCursor((i) => Math.min(total - 1, i + 1));
      } else if (key.shift && key.upArrow && editModelCursor > 0 && editModelCursor < editModels.length) {
        setEditModels((prev) => {
          const arr = [...prev];
          [arr[editModelCursor - 1], arr[editModelCursor]] = [arr[editModelCursor]!, arr[editModelCursor - 1]!];
          return arr;
        });
        setEditModelCursor((i) => i - 1);
      } else if (key.shift && key.downArrow && editModelCursor < editModels.length - 1) {
        setEditModels((prev) => {
          const arr = [...prev];
          [arr[editModelCursor], arr[editModelCursor + 1]] = [arr[editModelCursor + 1]!, arr[editModelCursor]!];
          return arr;
        });
        setEditModelCursor((i) => i + 1);
      } else if (input === 'd' && editFocus === 'models' && editModelCursor < editModels.length) {
        setEditModels((prev) => prev.filter((_, i) => i !== editModelCursor));
        setEditModelCursor((i) => Math.max(0, i - 1));
      } else if (key.return && editModelCursor === editModels.length) {
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
        <Text bold color="yellow">Profile has no models</Text>
        <Box marginTop={1}>
          <Text>Cannot save profile without at least one model.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Delete this profile? (y/n)</Text>
        </Box>
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (editSubStep !== null) {
    const subTitle = editSubStep === 'select-provider' ? 'Select provider'
      : editSubStep === 'select-model' ? 'Select model'
      : 'Assign tier';
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Edit Profile — {subTitle}</Text>
        <Text dimColor>Esc: back</Text>

        {editSubStep === 'select-provider' && (() => {
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
                    {isSelected ? '▶ ' : '  '}{p.name} ({p.type}, {p.models.length} models)
                  </Text>
                )}
              />
            </Box>
          );
        })()}

        {editSubStep === 'select-model' && (() => {
          const provider = providers.find((p) => p.id === pendingProviderId);
          if (!provider) return <></>;
          const customIdx = provider.models.length;
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓: navigate | Enter: select</Text>
              <Box marginTop={1}>
                <Text>Provider: <Text color="cyan">{provider.name}</Text></Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                {provider.models.map((m, i) => (
                  <Text key={m.name} color={i === modelCursor ? 'green' : undefined}>
                    {i === modelCursor ? '▶ ' : '  '}<Text color="gray">{capabilityMarker(m.capabilities)} </Text>{m.name}
                  </Text>
                ))}
                <Box>
                  <Text color={modelCursor === customIdx ? 'green' : 'cyan'}>
                    {modelCursor === customIdx ? '▶ ' : '  '}[custom]:{' '}
                  </Text>
                  <TextInput
                    value={customModel}
                    onChange={setCustomModel}
                    focus={modelCursor === customIdx}
                    showCursor={modelCursor === customIdx}
                    placeholder="model-name"
                  />
                </Box>
              </Box>
            </Box>
          );
        })()}

        {editSubStep === 'select-tier' && (() => {
          const provider = providers.find((p) => p.id === pendingProviderId);
          const usedTiers = new Set(editModels.map((m) => m.tier).filter(Boolean));
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓: navigate | Enter: confirm</Text>
              <Box marginTop={1}>
                <Text>Model: <Text color="cyan">{pendingModel}</Text> ({provider?.name ?? '?'})</Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                {TIERS.map((t, i) => (
                  <Text key={t} color={i === tierCursor ? 'green' : usedTiers.has(t) ? 'yellow' : undefined}>
                    {i === tierCursor ? '▶ ' : '  '}{t}{usedTiers.has(t) ? ' (already used)' : ''}
                  </Text>
                ))}
                <Text color={tierCursor === 3 ? 'green' : undefined} dimColor={tierCursor !== 3}>
                  {tierCursor === 3 ? '▶ ' : '  '}skip (no tier)
                </Text>
              </Box>
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
      <Text dimColor>Tab: navigate | Esc: cancel</Text>
      <Box marginTop={1}>
        <Text color={editFocus === 'name' ? 'green' : undefined}>
          {editFocus === 'name' ? '▶ ' : '  '}Name:{' '}
        </Text>
        <TextInput
          value={editName}
          onChange={setEditName}
          focus={editFocus === 'name'}
          showCursor={editFocus === 'name'}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          Models{editFocus === 'models' ? ' (↑↓ navigate | Shift+↑↓ reorder | d: delete model | Enter on [+]: add)' : ''}:
        </Text>
        {editModels.map((m, i) => {
          const p = providers.find((pr) => pr.id === m.providerId);
          const focused = editFocus === 'models' && i === editModelCursor;
          return (
            <Text key={i} color={focused ? 'green' : undefined}>
              {focused ? '▶ ' : '  '}{m.model}{m.tier ? ` [${m.tier}]` : ''} ({p?.name ?? m.providerId.slice(0, 8) + '...'})
            </Text>
          );
        })}
        <Text
          color="cyan"
          dimColor={!(editFocus === 'models' && editModelCursor === editModels.length)}
        >
          {editFocus === 'models' && editModelCursor === editModels.length ? '▶ ' : '  '}[+ add model]
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text
          color="cyan"
          bold={editFocus === 'save'}
        >
          {editFocus === 'save' ? '▶ ' : '  '}[S] Save Profile
        </Text>
      </Box>
      {status && <Text color="yellow">{status}</Text>}
    </Box>
  );
}
