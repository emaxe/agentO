import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeyInput } from '../use-key-input.js';
import { SelectList } from '../components/SelectList.js';
import type { Provider, Profile, ProfileModel, ModelTier } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';
import { validateProfile } from '../../config/validation.js';

const TIERS: ModelTier[] = ['small', 'base', 'smart'];
type WizardStep = 'name' | 'select-provider' | 'select-model' | 'select-tier' | 'review';

interface ProfileWizardProps {
  providers: Provider[];
  profiles: Profile[];
  onDone: (result: { name: string; models: ProfileModel[] }) => void;
  onCancel: () => void;
}

export function ProfileWizard({ providers, profiles, onDone, onCancel }: ProfileWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('name');
  const [formName, setFormName] = useState('');
  const [formModels, setFormModels] = useState<ProfileModel[]>([]);
  const [providerCursor, setProviderCursor] = useState(0);
  const [modelCursor, setModelCursor] = useState(0);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState('');
  const [tierCursor, setTierCursor] = useState(1);
  const [customModel, setCustomModel] = useState('');
  const [reviewCursor, setReviewCursor] = useState(0);
  const [status, setStatus] = useState('');

  const validateAndSubmit = useCallback(() => {
    try {
      const name = formName.trim();
      const modelsToSave: ProfileModel[] =
        formModels.length === 1
          ? [{ providerId: formModels[0]!.providerId, model: formModels[0]!.model }]
          : formModels;
      validateProfile({ name, models: modelsToSave }, profiles, providers);
      onDone({ name, models: modelsToSave });
    } catch (err) {
      setStatus(String(err));
    }
  }, [formName, formModels, profiles, providers, onDone]);

  useKeyInput((input, key) => {
    if (step === 'name') {
      if (key.escape) { onCancel(); return; }
      if (key.return) {
        if (!formName.trim()) { setStatus('Name required'); return; }
        setStatus('');
        setStep('select-provider');
      }
      return;
    }

    if (step === 'select-provider') {
      if (key.escape) {
        if (formModels.length > 0) { setStep('review'); return; }
        setStep('name'); return;
      }
      if (key.upArrow) { setProviderCursor((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setProviderCursor((i) => Math.min(providers.length - 1, i + 1)); return; }
      if (key.return && providers[providerCursor]) {
        setPendingProviderId(providers[providerCursor].id);
        setModelCursor(0);
        setCustomModel('');
        setStep('select-model');
      }
      if (input === 'f' && formModels.length > 0) {
        setStep('review');
      }
      return;
    }

    if (step === 'select-model') {
      const provider = providers.find((p) => p.id === pendingProviderId);
      if (!provider) { setStep('select-provider'); return; }
      const total = provider.models.length + 1;
      if (key.escape) { setStep('select-provider'); return; }
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
        const usedTiers = new Set(formModels.map((m) => m.tier).filter(Boolean));
        const defaultIdx = TIERS.findIndex((t) => !usedTiers.has(t));
        setTierCursor(defaultIdx === -1 ? 1 : defaultIdx);
        setStep('select-tier');
      }
      return;
    }

    if (step === 'select-tier') {
      const optionsCount = 4;
      if (key.escape) { setStep('select-model'); return; }
      if (key.upArrow) { setTierCursor((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setTierCursor((i) => Math.min(optionsCount - 1, i + 1)); return; }
      if (key.return) {
        const provider = providers.find((p) => p.id === pendingProviderId);
        if (!provider || !pendingModel) { setStep('select-provider'); return; }
        const tier = tierCursor < 3 ? TIERS[tierCursor] : undefined;
        setFormModels((arr) => [...arr, { providerId: provider.id, model: pendingModel, tier }]);
        setPendingModel('');
        setStep('review');
      }
      return;
    }

    if (step === 'review') {
      if (key.escape) { setStep('select-provider'); return; }
      if (key.upArrow) { setReviewCursor(0); return; }
      if (key.downArrow) { setReviewCursor(1); return; }
      if (key.return) {
        if (reviewCursor === 0) {
          setProviderCursor(0);
          setStep('select-provider');
        } else {
          validateAndSubmit();
        }
      }
      return;
    }
  });

  if (step === 'name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Enter profile name, Enter to continue, Esc to cancel</Text>
          <Box marginTop={1}>
            <Text>Name: </Text>
            <TextInput value={formName} onChange={setFormName} focus showCursor />
          </Box>
        </Box>
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (step === 'select-provider') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>↑↓: navigate | Enter: select | {formModels.length > 0 ? 'f: finish | ' : ''}Esc: back</Text>
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
          <SelectList
            items={providers}
            selected={providerCursor}
            title="Select provider:"
            renderItem={(p, i, isSelected) => (
              <Text color={isSelected ? 'green' : undefined}>
                {isSelected ? '▶ ' : '  '}{p.name} ({p.type}, {p.models.length} models)
              </Text>
            )}
          />
        </Box>
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (step === 'select-model') {
    const provider = providers.find((p) => p.id === pendingProviderId);
    if (!provider) return <></>;
    const customIdx = provider.models.length;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>
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
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (step === 'select-tier') {
    const provider = providers.find((p) => p.id === pendingProviderId);
    const usedTiers = new Set(formModels.map((m) => m.tier).filter(Boolean));
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>
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
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  // review
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Add Profile</Text>
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
      {status && <Text color="yellow">{status}</Text>}
    </Box>
  );
}
