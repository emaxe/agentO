import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import TextInput from 'ink-text-input';
import { listProfiles, addProfile, updateProfile, removeProfile } from '../../profiles/profile-manager.js';
import { listProviders } from '../../providers/provider-manager.js';
import type { Profile, Provider, ProfileModel, ModelTier } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'detail' | 'edit' | 'confirm-delete';
type AddStep = 'name' | 'select-provider' | 'select-model' | 'select-tier' | 'review';
type EditSubStep = 'select-provider' | 'select-model' | 'select-tier';

const TIERS: ModelTier[] = ['small', 'base', 'smart'];

interface ProfilesProps {
  onBack: () => void;
}

export function Profiles({ onBack }: ProfilesProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailModelIndex, setDetailModelIndex] = useState(0);
  const [status, setStatus] = useState('');

  // Add wizard state
  const [addStep, setAddStep] = useState<AddStep>('name');
  const [formName, setFormName] = useState('');
  const [formModels, setFormModels] = useState<ProfileModel[]>([]);
  const [providerCursor, setProviderCursor] = useState(0);
  const [modelCursor, setModelCursor] = useState(0);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string>('');
  const [tierCursor, setTierCursor] = useState(1); // 0=small,1=base,2=smart
  const [customModel, setCustomModel] = useState('');
  const [reviewCursor, setReviewCursor] = useState(0); // 0 = add more, 1 = save

  // Edit mode state
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editModels, setEditModels] = useState<ProfileModel[]>([]);
  const [editModelCursor, setEditModelCursor] = useState(0);
  const [editFocus, setEditFocus] = useState<'name' | 'models'>('models');
  const [editSubStep, setEditSubStep] = useState<EditSubStep | null>(null);

  const reload = useCallback(() => {
    listProfiles().then(setProfiles).catch(console.error);
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const resetAddWizard = useCallback(() => {
    setAddStep('name');
    setFormName('');
    setFormModels([]);
    setProviderCursor(0);
    setModelCursor(0);
    setPendingProviderId(null);
    setPendingModel('');
    setTierCursor(1);
    setCustomModel('');
    setReviewCursor(0);
    setStatus('');
  }, []);

  const submitProfile = useCallback(() => {
    if (!formName || formModels.length === 0) {
      setStatus('Name and at least one model required');
      return;
    }
    // Если в профиле >1 модели — tier обязателен; нормализуем (одна модель = без tier).
    let modelsToSave: ProfileModel[];
    if (formModels.length === 1) {
      modelsToSave = [{ providerId: formModels[0]!.providerId, model: formModels[0]!.model }];
    } else {
      const missingTier = formModels.some((m) => !m.tier);
      if (missingTier) {
        setStatus('All models must have a tier when there are multiple');
        return;
      }
      const hasBase = formModels.some((m) => m.tier === 'base');
      if (!hasBase) {
        setStatus('At least one model must have tier=base');
        return;
      }
      modelsToSave = formModels;
    }
    addProfile({ name: formName, models: modelsToSave })
      .then((p) => { setStatus(`Added "${p.name}"`); reload(); setMode('list'); })
      .catch((err) => setStatus(`Error: ${String(err)}`));
  }, [formName, formModels, reload]);

  const submitEdit = useCallback(() => {
    if (!editProfile || !editName.trim() || editModels.length === 0) {
      setStatus('Name and at least one model required');
      return;
    }
    let modelsToSave: ProfileModel[];
    if (editModels.length === 1) {
      modelsToSave = [{ providerId: editModels[0]!.providerId, model: editModels[0]!.model }];
    } else {
      const missingTier = editModels.some((m) => !m.tier);
      if (missingTier) {
        setStatus('All models must have a tier when there are multiple');
        return;
      }
      const hasBase = editModels.some((m) => m.tier === 'base');
      if (!hasBase) {
        setStatus('At least one model must have tier=base');
        return;
      }
      modelsToSave = editModels;
    }
    updateProfile(editProfile.id, { name: editName.trim(), models: modelsToSave })
      .then((updated) => { setDetailProfile(updated); reload(); setMode('detail'); })
      .catch((err) => setStatus(`Error: ${String(err)}`));
  }, [editProfile, editName, editModels, reload]);

  useKeyInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
      else if (key.return && profiles[selectedIndex]) {
        setDetailProfile(profiles[selectedIndex]);
        setDetailModelIndex(0);
        setMode('detail');
      }
      else if (input === 'a') {
        if (providers.length === 0) {
          setStatus('Add at least one provider first');
          return;
        }
        resetAddWizard();
        setMode('add');
      }
      else if (input === 'd' && profiles[selectedIndex]) {
        setMode('confirm-delete');
      }
      return;
    }

    if (mode === 'confirm-delete') {
      if (input === 'y' && profiles[selectedIndex]) {
        removeProfile(profiles[selectedIndex].id)
          .then(() => { setStatus(`Deleted`); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
      return;
    }

    if (mode === 'detail' && detailProfile) {
      if (key.escape || input === 'q') { setMode('list'); return; }
      if (input === 'd') {
        if (detailProfile.models.length <= 1) {
          setStatus('Cannot delete the last model');
          return;
        }
        const newModels = detailProfile.models.filter((_, i) => i !== detailModelIndex);
        updateProfile(detailProfile.id, { models: newModels })
          .then((updated) => {
            setDetailProfile(updated);
            reload();
            setDetailModelIndex(Math.max(0, detailModelIndex - 1));
            setStatus('');
          })
          .catch((err) => setStatus(`Error: ${String(err)}`));
        return;
      }
      if (input === 'a') {
        setEditProfile(detailProfile);
        setEditName(detailProfile.name);
        setEditModels([...detailProfile.models]);
        setEditModelCursor(detailProfile.models.length); // курсор на [+ add model]
        setEditFocus('models');
        setEditSubStep('select-provider');
        setProviderCursor(0);
        setModelCursor(0);
        setCustomModel('');
        setStatus('');
        setMode('edit');
        return;
      }
      if (input === 'e') {
        setEditProfile(detailProfile);
        setEditName(detailProfile.name);
        setEditModels([...detailProfile.models]);
        setEditModelCursor(0);
        setEditFocus('name');
        setEditSubStep(null);
        setProviderCursor(0);
        setModelCursor(0);
        setCustomModel('');
        setStatus('');
        setMode('edit');
        return;
      }
      if (key.upArrow) {
        setDetailModelIndex(Math.max(0, detailModelIndex - 1));
      } else if (key.downArrow) {
        setDetailModelIndex(Math.min(detailProfile.models.length - 1, detailModelIndex + 1));
      }
      return;
    }

    if (mode === 'add') {
      if (key.escape) {
        if (addStep === 'name') { setMode('list'); return; }
        if (addStep === 'select-provider') {
          if (formModels.length > 0) { setAddStep('review'); return; }
          setAddStep('name'); return;
        }
        if (addStep === 'select-model') { setAddStep('select-provider'); return; }
        if (addStep === 'select-tier') { setAddStep('select-model'); return; }
        if (addStep === 'review') { setAddStep('select-provider'); return; }
        return;
      }

      if (addStep === 'name') {
        if (key.return) {
          if (!formName.trim()) { setStatus('Name required'); return; }
          setStatus('');
          setAddStep('select-provider');
        }
        return; // text input handled by TextInput
      }

      if (addStep === 'select-provider') {
        if (key.upArrow) setProviderCursor((i) => Math.max(0, i - 1));
        else if (key.downArrow) setProviderCursor((i) => Math.min(providers.length - 1, i + 1));
        else if (key.return && providers[providerCursor]) {
          setPendingProviderId(providers[providerCursor].id);
          setModelCursor(0);
          setCustomModel('');
          setAddStep('select-model');
        } else if (input === 'f' && formModels.length > 0) {
          setAddStep('review');
        }
        return;
      }

      if (addStep === 'select-model') {
        const provider = providers.find((p) => p.id === pendingProviderId);
        if (!provider) { setAddStep('select-provider'); return; }
        const total = provider.models.length + 1; // +1 for custom entry
        if (key.upArrow) setModelCursor((i) => Math.max(0, i - 1));
        else if (key.downArrow) setModelCursor((i) => Math.min(total - 1, i + 1));
        else if (key.return) {
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
          // Подсказка курсора tier: первая модель -> base, иначе следующий незанятый.
          const usedTiers = new Set(formModels.map((m) => m.tier).filter(Boolean));
          const defaultIdx = TIERS.findIndex((t) => !usedTiers.has(t));
          setTierCursor(defaultIdx === -1 ? 1 : defaultIdx);
          setAddStep('select-tier');
        }
        return;
      }

      if (addStep === 'select-tier') {
        // Предлагаем 4 варианта: small / base / smart / skip(no tier)
        const optionsCount = 4;
        if (key.upArrow) setTierCursor((i) => Math.max(0, i - 1));
        else if (key.downArrow) setTierCursor((i) => Math.min(optionsCount - 1, i + 1));
        else if (key.return) {
          const provider = providers.find((p) => p.id === pendingProviderId);
          if (!provider || !pendingModel) { setAddStep('select-provider'); return; }
          const tier = tierCursor < 3 ? TIERS[tierCursor] : undefined;
          setFormModels((arr) => [...arr, { providerId: provider.id, model: pendingModel, tier }]);
          setPendingModel('');
          setAddStep('review');
        }
        return;
      }

      if (addStep === 'review') {
        if (key.upArrow) setReviewCursor(0);
        else if (key.downArrow) setReviewCursor(1);
        else if (key.return) {
          if (reviewCursor === 0) {
            setProviderCursor(0);
            setAddStep('select-provider');
          } else {
            submitProfile();
          }
        }
        return;
      }
    }
    if (mode === 'edit') {
      // Sub-flow: adding a model within edit mode
      if (editSubStep !== null) {
        if (key.escape) {
          if (editSubStep === 'select-provider') { setEditSubStep(null); return; }
          if (editSubStep === 'select-model') { setEditSubStep('select-provider'); return; }
          if (editSubStep === 'select-tier') { setEditSubStep('select-model'); return; }
        }
        if (editSubStep === 'select-provider') {
          if (key.upArrow) setProviderCursor((i) => Math.max(0, i - 1));
          else if (key.downArrow) setProviderCursor((i) => Math.min(providers.length - 1, i + 1));
          else if (key.return && providers[providerCursor]) {
            setPendingProviderId(providers[providerCursor].id);
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
          if (key.upArrow) setModelCursor((i) => Math.max(0, i - 1));
          else if (key.downArrow) setModelCursor((i) => Math.min(total - 1, i + 1));
          else if (key.return) {
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
          if (key.upArrow) setTierCursor((i) => Math.max(0, i - 1));
          else if (key.downArrow) setTierCursor((i) => Math.min(optionsCount - 1, i + 1));
          else if (key.return) {
            const provider = providers.find((p) => p.id === pendingProviderId);
            if (!provider || !pendingModel) { setEditSubStep('select-provider'); return; }
            const tier = tierCursor < 3 ? TIERS[tierCursor] : undefined;
            setEditModels((prev) => [...prev, { providerId: provider.id, model: pendingModel, tier }]);
            setPendingModel('');
            setEditSubStep(null);
          }
          return;
        }
      }

      // Main edit controls
      if (key.escape) { setMode('detail'); return; }
      if (key.tab) {
        setEditFocus((f) => f === 'name' ? 'models' : 'name');
        return;
      }
      if (input === 's') { submitEdit(); return; }

      if (editFocus === 'name') {
        if (key.return) { setEditFocus('models'); return; }
        return; // TextInput handles text input
      }

      if (editFocus === 'models') {
        const total = editModels.length + 1; // +1 for [+ add model]
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
        } else if (input === 'd' && editModels[editModelCursor]) {
          setEditModels((prev) => prev.filter((_, i) => i !== editModelCursor));
          setEditModelCursor((i) => Math.max(0, i - 1));
        } else if (key.return && editModelCursor === editModels.length) {
          setProviderCursor(0);
          setModelCursor(0);
          setCustomModel('');
          setEditSubStep('select-provider');
        }
      }
      return;
    }
  });

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Delete profile <Text bold>"{profiles[selectedIndex]?.name}"</Text>? (y/n)</Text>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>

        {addStep === 'name' && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Enter profile name, Enter to continue, Esc to cancel</Text>
            <Box marginTop={1}>
              <Text>Name: </Text>
              <TextInput value={formName} onChange={setFormName} focus showCursor />
            </Box>
          </Box>
        )}

        {addStep === 'select-provider' && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>↑↓: navigate | Enter: select | {formModels.length > 0 ? "f: finish | " : ''}Esc: back</Text>
            {formModels.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>Already added ({formModels.length}):</Text>
                {formModels.map((m, i) => {
                  const p = providers.find((pr) => pr.id === m.providerId);
                  return (
                    <Text key={i} dimColor>
                      {'  • '}{p?.name ?? '?'}: {m.model}{m.tier ? ` [${m.tier}]` : ''}
                    </Text>
                  );
                })}
              </Box>
            )}
            <Box flexDirection="column" marginTop={1}>
              <Text>Select provider:</Text>
              {providers.map((p, i) => (
                <Text key={p.id} color={i === providerCursor ? 'green' : undefined}>
                  {i === providerCursor ? '▶ ' : '  '}{p.name} ({p.type}, {p.models.length} models)
                </Text>
              ))}
            </Box>
          </Box>
        )}

        {addStep === 'select-model' && (() => {
          const provider = providers.find((p) => p.id === pendingProviderId);
          if (!provider) return null;
          const customIdx = provider.models.length;
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓: navigate | Enter: select | Esc: back</Text>
              <Box marginTop={1}>
                <Text>Provider: <Text color="cyan">{provider.name}</Text></Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                <Text>Select model:</Text>
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

        {addStep === 'select-tier' && (() => {
          const provider = providers.find((p) => p.id === pendingProviderId);
          const usedTiers = new Set(formModels.map((m) => m.tier).filter(Boolean));
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓: navigate | Enter: confirm | Esc: back</Text>
              <Box marginTop={1}>
                <Text>Model: <Text color="cyan">{pendingModel}</Text> ({provider?.name ?? '?'})</Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                <Text>Assign tier:</Text>
                {TIERS.map((t, i) => (
                  <Text key={t} color={i === tierCursor ? 'green' : usedTiers.has(t) ? 'yellow' : undefined}>
                    {i === tierCursor ? '▶ ' : '  '}{t}{usedTiers.has(t) ? ' (already used — will be replaced visually)' : ''}
                  </Text>
                ))}
                <Text color={tierCursor === 3 ? 'green' : undefined} dimColor={tierCursor !== 3}>
                  {tierCursor === 3 ? '▶ ' : '  '}skip (no tier — only valid for single-model profiles)
                </Text>
              </Box>
              <Box marginTop={1}>
                <Text dimColor>
                  Tip: small=ANTHROPIC_SMALL_FAST/HAIKU, base=ANTHROPIC_MODEL/SONNET, smart=OPUS.
                </Text>
              </Box>
            </Box>
          );
        })()}

        {addStep === 'review' && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>↑↓: choose | Enter: confirm | Esc: back</Text>
            <Box flexDirection="column" marginTop={1}>
              <Text>Profile: <Text color="cyan">{formName}</Text></Text>
              <Text>Models ({formModels.length}):</Text>
              {formModels.map((m, i) => {
                const p = providers.find((pr) => pr.id === m.providerId);
                return (
                  <Text key={i}>
                    {'  • '}{p?.name ?? '?'}: {m.model}{m.tier ? ` [${m.tier}]` : ''}
                  </Text>
                );
              })}
            </Box>
            <Box flexDirection="column" marginTop={1}>
              <Text color={reviewCursor === 0 ? 'green' : undefined}>
                {reviewCursor === 0 ? '▶ ' : '  '}[+ Add another model]
              </Text>
              <Text color={reviewCursor === 1 ? 'green' : undefined}>
                {reviewCursor === 1 ? '▶ ' : '  '}[✓ Save profile]
              </Text>
            </Box>
          </Box>
        )}

        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (mode === 'edit' && editProfile) {
    // Sub-flow render: adding a model
    if (editSubStep !== null) {
      const subTitle = editSubStep === 'select-provider' ? 'Select provider'
        : editSubStep === 'select-model' ? 'Select model'
        : 'Assign tier';
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold>Edit Profile — {subTitle}</Text>
          <Text dimColor>Esc: back</Text>

          {editSubStep === 'select-provider' && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓: navigate | Enter: select</Text>
              <Box flexDirection="column" marginTop={1}>
                {providers.map((p, i) => (
                  <Text key={p.id} color={i === providerCursor ? 'green' : undefined}>
                    {i === providerCursor ? '▶ ' : '  '}{p.name} ({p.type}, {p.models.length} models)
                  </Text>
                ))}
              </Box>
            </Box>
          )}

          {editSubStep === 'select-model' && (() => {
            const provider = providers.find((p) => p.id === pendingProviderId);
            if (!provider) return null;
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

    // Main edit screen
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Edit Profile</Text>
        <Text dimColor>Tab: name/models focus | s: save | Esc: cancel</Text>
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
            Models{editFocus === 'models' ? ' (↑↓ navigate | Shift+↑↓ reorder | d: delete | Enter on [+]: add)' : ''}:
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
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (mode === 'detail' && detailProfile) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{detailProfile.name}</Text>
        <Text dimColor>↑↓ navigate | a: add | d: delete | e: edit | Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {detailProfile.models.map((m, i) => {
            const p = providers.find((pr) => pr.id === m.providerId);
            return (
              <Text key={i} color={i === detailModelIndex ? 'green' : undefined}>
                {i === detailModelIndex ? '▶ ' : '  '}{m.model}{m.tier ? ` [${m.tier}]` : ''} (provider: {p?.name ?? m.providerId.slice(0, 8) + '...'})
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Profiles</Text>
      <Text dimColor>↑↓ navigate | Enter: detail | a: add | d: delete | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {profiles.map((p, i) => (
          <Text key={p.id} color={i === selectedIndex ? 'green' : undefined}>
            {i === selectedIndex ? '▶ ' : '  '}{p.name} ({p.models.length} models)
          </Text>
        ))}
        {profiles.length === 0 && <Text dimColor>No profiles. Press 'a' to add.</Text>}
      </Box>
    </Box>
  );
}
