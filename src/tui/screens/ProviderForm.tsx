import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeyInput } from '../use-key-input.js';
import type { Provider, ModelConfig, ProviderType } from '../../config/schema.js';
import { capabilityMarker, PROVIDER_TYPES } from '../../config/schema.js';

type FieldName = 'name' | 'type' | 'apiKey' | 'baseUrl' | 'models';
type StringField = 'name' | 'apiKey' | 'baseUrl';

const FIELDS: FieldName[] = ['name', 'type', 'apiKey', 'baseUrl', 'models'];

interface FormState {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string;
  models: ModelConfig[];
}

const INITIAL_FORM: FormState = {
  name: '',
  type: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  models: [],
};

interface ProviderFormProps {
  provider?: Provider;
  onSubmit: (data: { name: string; type: ProviderType; apiKey: string; baseUrl?: string; models: ModelConfig[] }) => void;
  onCancel: () => void;
}

function labelFor(f: FieldName): string {
  switch (f) {
    case 'name': return 'Name:    ';
    case 'type': return 'Type:    ';
    case 'apiKey': return 'API Key: ';
    case 'baseUrl': return 'Base URL:';
    case 'models': return 'Models:  ';
  }
}

export function ProviderForm({ provider, onSubmit, onCancel }: ProviderFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(
    provider
      ? {
          name: provider.name,
          type: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl ?? '',
          models: provider.models.map((m) => ({ ...m, capabilities: { ...m.capabilities } })),
        }
      : INITIAL_FORM,
  );
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [modelsListIndex, setModelsListIndex] = useState(0);
  const [modelsEditingIndex, setModelsEditingIndex] = useState<number | null>(null);
  const [modelsAddingNew, setModelsAddingNew] = useState(false);
  const [modelsNewValue, setModelsNewValue] = useState('');
  const [status, setStatus] = useState('');

  const activeField: FieldName = FIELDS[activeFieldIndex] ?? 'name';

  useEffect(() => {
    if (activeField !== 'models') {
      setModelsEditingIndex(null);
      setModelsAddingNew(false);
    }
  }, [activeField]);

  const doSubmit = useCallback(() => {
    const models = form.models.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
    if (!form.name || !form.apiKey || models.length === 0) {
      setStatus('Name, API key and at least one model required');
      return;
    }
    onSubmit({
      name: form.name,
      type: form.type,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl || undefined,
      models,
    });
  }, [form, onSubmit]);

  useKeyInput((input, key) => {
    if (key.escape) {
      if (modelsEditingIndex !== null) { setModelsEditingIndex(null); return; }
      if (modelsAddingNew) { setModelsAddingNew(false); return; }
      onCancel();
      return;
    }

    // When a models TextInput is active, block other key handling
    if (activeField === 'models' && (modelsEditingIndex !== null || modelsAddingNew)) {
      return;
    }

    // Models list navigation (models field focused, not editing)
    if (activeField === 'models') {
      if (key.upArrow) { setModelsListIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelsListIndex((i) => Math.min(form.models.length, i + 1)); return; }
      if (modelsListIndex < form.models.length) {
        if (input === 'i') {
          setForm((f) => ({ ...f, models: f.models.map((m, j) => j === modelsListIndex ? { ...m, capabilities: { ...m.capabilities, image: !m.capabilities.image } } : m) }));
          return;
        }
        if (input === 'v') {
          setForm((f) => ({ ...f, models: f.models.map((m, j) => j === modelsListIndex ? { ...m, capabilities: { ...m.capabilities, video: !m.capabilities.video } } : m) }));
          return;
        }
        if (input === 'a') {
          setForm((f) => ({ ...f, models: f.models.map((m, j) => j === modelsListIndex ? { ...m, capabilities: { ...m.capabilities, audio: !m.capabilities.audio } } : m) }));
          return;
        }
      }
      if (input === 'd' && form.models.length > 0 && modelsListIndex < form.models.length) {
        setForm((f) => ({ ...f, models: f.models.filter((_, idx) => idx !== modelsListIndex) }));
        setModelsListIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (input === 'e' && form.models.length > 0 && modelsListIndex < form.models.length) {
        setModelsEditingIndex(modelsListIndex);
        return;
      }
      if (key.return && modelsListIndex === form.models.length) {
        setModelsAddingNew(true);
        setModelsNewValue('');
        return;
      }
    }

    // Field navigation
    if ((key.tab && key.shift) || key.upArrow) {
      setActiveFieldIndex((i) => (i - 1 + FIELDS.length) % FIELDS.length);
      return;
    }
    if ((key.tab && !key.shift) || key.downArrow) {
      setActiveFieldIndex((i) => (i + 1) % FIELDS.length);
      return;
    }

    // Type field toggle
    if (activeField === 'type') {
      if (key.return || input === ' ' || key.leftArrow || key.rightArrow) {
        const currentIndex = PROVIDER_TYPES.indexOf(form.type);
        const nextIndex = (currentIndex + 1) % PROVIDER_TYPES.length;
        setForm((f) => ({ ...f, type: PROVIDER_TYPES[nextIndex]! }));
        return;
      }
    }

    // Submit on Enter when models field is focused (on a real model row, not [+ add])
    if (key.return && activeField === 'models' && modelsListIndex < form.models.length) {
      doSubmit();
      return;
    }
  });

  const inModelsEdit = modelsEditingIndex !== null || modelsAddingNew;
  const hint = inModelsEdit
    ? 'Enter: save item  Esc: cancel'
    : activeField === 'models'
      ? '↑↓: navigate  i/v/a: toggle caps  d: del  e: edit  Enter: add/save'
      : 'Tab/↑↓: navigate  Space/←→: toggle type  Enter: save  Esc: cancel';

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{provider ? 'Edit Provider' : 'Add Provider'}</Text>
      <Text dimColor>{hint}</Text>
      <Box flexDirection="column" marginTop={1}>
        {FIELDS.map((field, i) => {
          const focused = i === activeFieldIndex;
          const labelColor = focused ? 'green' : 'white';
          return (
            <Box key={field} flexDirection="column">
              <Box>
                <Text color={labelColor}>{focused ? '▶ ' : '  '}{labelFor(field)} </Text>
                {field === 'type' && (
                  <Text>{focused ? '◀ ' : '  '}{form.type}{focused ? ' ▶' : ''}</Text>
                )}
                {field !== 'type' && field !== 'models' && (
                  <TextInput
                    value={form[field as StringField]}
                    onChange={(value) => setForm((f) => ({ ...f, [field]: value }))}
                    focus={focused}
                    showCursor={focused}
                    placeholder={field === 'baseUrl' ? '(optional)' : ''}
                  />
                )}
              </Box>
              {field === 'models' && (
                <Box flexDirection="column" paddingLeft={4}>
                  {form.models.length === 0 && !modelsAddingNew && (
                    <Text dimColor>(no models)</Text>
                  )}
                  {form.models.map((model, idx) => (
                    <Box key={idx}>
                      <Text color={focused ? 'cyan' : undefined}>
                        {focused && modelsListIndex === idx && modelsEditingIndex === null
                          ? '▶ '
                          : '  '}
                      </Text>
                      {modelsEditingIndex === idx ? (
                        <TextInput
                          value={model.name}
                          focus
                          onChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              models: f.models.map((m, j) => (j === idx ? { ...m, name: v } : m)),
                            }))
                          }
                          onSubmit={() => setModelsEditingIndex(null)}
                        />
                      ) : (
                        <Text dimColor={!focused}><Text color="gray">{capabilityMarker(model.capabilities)} </Text>{model.name}</Text>
                      )}
                    </Box>
                  ))}
                  {modelsAddingNew && (
                    <Box>
                      <Text color="green">+ </Text>
                      <TextInput
                        value={modelsNewValue}
                        focus
                        onChange={setModelsNewValue}
                        onSubmit={() => {
                          const trimmed = modelsNewValue.trim();
                          if (trimmed) setForm((f) => ({ ...f, models: [...f.models, { name: trimmed, capabilities: { image: true, video: false, audio: false } }] }));
                          setModelsAddingNew(false);
                          setModelsNewValue('');
                        }}
                      />
                    </Box>
                  )}
                  {!modelsAddingNew && (
                    <Text
                      color={focused && modelsListIndex === form.models.length ? 'green' : 'cyan'}
                      dimColor={!(focused && modelsListIndex === form.models.length)}
                    >
                      {focused && modelsListIndex === form.models.length ? '▶ ' : '  '}[+ add model]
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {status && <Text color="yellow">{status}</Text>}
    </Box>
  );
}
