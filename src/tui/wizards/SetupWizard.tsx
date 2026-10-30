import React, { useEffect, useState, useRef } from 'react';
import { Text } from 'ink';
import TextInput from 'ink-text-input';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { ProviderForm, type ProviderDraft } from '../screens/ProviderForm.js';
import { LaunchAgent } from '../screens/LaunchAgent.js';
import { useKeyInput } from '../use-key-input.js';
import type { AgentInstallStatus } from '../../config/store.js';
import { readConfig } from '../../config/store.js';
import { addProvider } from '../../providers/provider-manager.js';
import { addProfile } from '../../profiles/profile-manager.js';
import type { Profile, Provider, ProviderType } from '../../config/schema.js';
import type { ExecRequest } from '../../launcher/independent.js';
import { sanitizeFieldValue } from '../sanitize-field-value.js';

const SERVICES: { name: string; type: ProviderType; detail: string }[] = [
  { name: 'OpenAI', type: 'openai-compatible', detail: 'Chat Completions API' },
  { name: 'Anthropic', type: 'anthropic-compatible', detail: 'Messages API' },
  { name: 'OpenRouter', type: 'openrouter', detail: 'Multiple API formats' },
  { name: 'Fireworks', type: 'fireworks', detail: 'Hosted models' },
  {
    name: 'Custom endpoint',
    type: 'openai-compatible',
    detail: 'Choose the API format in the connection form',
  },
];

export function SetupWizard({
  onBack,
  onExec,
  dev,
  agentStatusCache,
}: {
  onBack: () => void;
  onExec: (req: ExecRequest) => void;
  dev?: boolean;
  agentStatusCache?: Record<string, AgentInstallStatus>;
}) {
  const [step, setStep] = useState<
    'provider' | 'service' | 'connection' | 'model' | 'profile' | 'launch'
  >('provider');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [profile, setProfile] = useState<Profile>();
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<ProviderDraft>();
  const [model, setModel] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('Loading configuration...');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    readConfig()
      .then((config) => {
        setProviders(config.providers);
        setProfiles(config.profiles);
        setStatus('');
        if (!config.providers.length) setStep('service');
      })
      .catch((err) => setStatus(`Error: ${String(err)}`));
  }, []);
  const chooseModel = (chosen: string) => {
    setModel(chosen);
    if (!name) {
      const base = chosen.split('/').pop() || 'default';
      let proposed = base;
      for (let n = 2; profiles.some((p) => p.name === proposed); n++) proposed = `${base} ${n}`;
      setName(proposed);
    }
    setStep('profile');
  };
  useKeyInput((input, key) => {
    if (['connection', 'launch'].includes(step) || savingRef.current) return;
    if (key.escape) {
      if (step === 'profile') {
        setStep('model');
        setCursor(0);
      } else if (step === 'model') {
        setStep('provider');
        setCursor(0);
      } else if (step === 'service' && providers.length) {
        setStep('provider');
        setCursor(0);
      } else onBack();
      return;
    }
    const total =
      step === 'provider'
        ? providers.length + 1
        : step === 'service'
          ? SERVICES.length
          : (provider?.models.length ?? 0) + 1;
    if (step !== 'profile' && key.upArrow) setCursor((i) => Math.max(0, i - 1));
    else if (step !== 'profile' && key.downArrow) setCursor((i) => Math.min(total - 1, i + 1));
    else if (key.return) {
      if (step === 'provider') {
        if (cursor === providers.length) setStep('service');
        else {
          setProvider(providers[cursor]);
          setStep('model');
        }
        setCursor(0);
      } else if (step === 'service') {
        const service = SERVICES[cursor]!;
        setDraft((existing) =>
          existing?.type === service.type
            ? existing
            : {
                name: service.name === 'Custom endpoint' ? '' : service.name,
                type: service.type,
                apiKey: '',
                baseUrl: '',
                models: [],
                customApiModes: null,
              },
        );
        setStep('connection');
      } else if (step === 'model') {
        const chosen = provider?.models[cursor]?.name ?? model.trim();
        if (chosen) chooseModel(chosen);
        else setStatus('Error: enter a model name.');
      } else if (step === 'profile' && provider) {
        const existing = profiles.find(
          (p) =>
            p.name === name.trim() &&
            p.models.length === 1 &&
            p.models[0]?.model === model &&
            p.models[0]?.providerId === provider.id,
        );
        if (existing) {
          setProfile(existing);
          setStep('launch');
          return;
        }
        savingRef.current = true;
        setSaving(true);
        setStatus('Saving profile...');
        addProfile({ name: name.trim(), models: [{ providerId: provider.id, model }] })
          .then((result) => {
            setProfile(result);
            setProfiles((items) => [...items, result]);
            setStep('launch');
            setStatus('');
          })
          .catch((err) => setStatus(`Error: ${String(err)}`))
          .finally(() => {
            savingRef.current = false;
            setSaving(false);
          });
      }
    }
  });
  if (step === 'connection')
    return (
      <ProviderForm
        initialDraft={draft}
        onDraftChange={setDraft}
        providers={providers}
        onCancel={() => {
          setDraft(undefined);
          setStep('service');
        }}
        onSubmit={async (data) => {
          const saved = await addProvider(data);
          setProvider(saved);
          setProviders((ps) => [...ps, saved]);
          setCursor(0);
          setStep('model');
        }}
      />
    );
  if (step === 'launch' && profile)
    return (
      <LaunchAgent
        dev={dev}
        agentStatusCache={agentStatusCache}
        initialProfileId={profile.id}
        forceReview
        onBack={() => {
          setStep('profile');
          setCursor(0);
        }}
        onExec={onExec}
      />
    );
  return (
    <ScreenFrame
      title="Set up AgentO"
      step={
        step === 'service'
          ? '1/6 · Provider service'
          : step === 'provider'
            ? '1/6 · Provider'
            : step === 'model'
              ? '2/6 · Model'
              : '3/6 · Profile'
      }
      status={status}
      actions={
        step === 'profile'
          ? 'Enter: save / use profile and choose agent | Esc: model'
          : '↑↓ choose | Enter continue | Esc back'
      }
    >
      {step === 'provider' && (
        <SelectList
          items={[
            ...providers.map((p) => ({ id: p.id, name: p.name })),
            { id: 'add', name: '+ Connect another provider' },
          ]}
          selected={cursor}
          renderItem={(item, i, selected) => (
            <Text color={selected ? 'green' : undefined}>
              {selected ? '▶ ' : '  '}
              {item.name}
            </Text>
          )}
        />
      )}
      {step === 'service' && (
        <SelectList
          items={SERVICES}
          selected={cursor}
          renderItem={(item, i, selected) => (
            <Text color={selected ? 'green' : undefined}>
              {selected ? '▶ ' : '  '}
              {item.name} · {item.detail}
            </Text>
          )}
        />
      )}
      {step === 'model' && provider && (
        <>
          <Text>{provider.name} · Choose a saved model or enter its name manually.</Text>
          <SelectList
            items={provider.models}
            selected={cursor}
            renderItem={(item, i, selected) => (
              <Text color={selected ? 'green' : undefined}>
                {selected ? '▶ ' : '  '}
                {item.name}
              </Text>
            )}
          />
          <Text>Manual model:</Text>
          <TextInput value={model} onChange={setModel} focus={cursor === provider.models.length} />
        </>
      )}
      {step === 'profile' && (
        <>
          <Text>
            Model: {model} ({provider?.name})
          </Text>
          <Text>Profile name:</Text>
          <TextInput
            value={name}
            onChange={(value) => setName(sanitizeFieldValue(value))}
            focus={!saving}
          />
          <Text dimColor>
            Enter saves this profile or reuses a matching saved profile. Completed steps remain
            available.
          </Text>
        </>
      )}
    </ScreenFrame>
  );
}
