import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeyInput } from '../use-key-input.js';
import type { Provider, ModelConfig, ProviderType } from '../../config/schema.js';
import { capabilityMarker, PROVIDER_TYPES } from '../../config/schema.js';
import { validateProvider } from '../../config/validation.js';

type FieldName = 'name' | 'type' | 'apiKey' | 'baseUrl' | 'customApiModes' | 'models' | 'save';
type StringField = 'name' | 'apiKey' | 'baseUrl';

const FIELDS: FieldName[] = ['name', 'type', 'apiKey', 'baseUrl', 'customApiModes', 'models', 'save'];

interface FormState {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string;
  customApiModes: { openai: boolean; anthropic: boolean; responses: boolean } | null;
  models: ModelConfig[];
}

const INITIAL_FORM: FormState = {
  name: '',
  type: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  customApiModes: null,
  models: [],
};

interface ProviderFormProps {
  provider?: Provider;
  providers: Provider[];
  onSubmit: (data: { name: string; type: ProviderType; apiKey: string; baseUrl?: string; customApiModes?: { openai: boolean; anthropic: boolean; responses: boolean }; models: ModelConfig[] }) => Promise<void> | void;
  onCancel: () => void;
}

function labelFor(f: FieldName): string {
  switch (f) {
    case 'name': return 'Name:    ';
    case 'type': return 'Type:    ';
    case 'apiKey': return 'API Key: ';
    case 'baseUrl': return 'Base URL:';
    case 'customApiModes': return 'API Modes:';
    case 'models': return 'Models:  ';
    case 'save': return 'Save:    ';
  }
}

export function ProviderForm({ provider, providers, onSubmit, onCancel }: ProviderFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(
    provider
      ? {
          name: provider.name,
          type: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl ?? '',
          customApiModes: provider.customApiModes
            ? { ...provider.customApiModes }
            : provider.type === 'custom-api'
              ? { openai: false, anthropic: false, responses: false }
              : null,
          models: provider.models.map((m) => ({ ...m, capabilities: { ...m.capabilities } })),
        }
      : INITIAL_FORM,
  );
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [subMode, setSubMode] = useState<'form' | 'models'>('form');
  const [modelsListIndex, setModelsListIndex] = useState(0);
  const [modelsEditingIndex, setModelsEditingIndex] = useState<number | null>(null);
  const [modelsAddingNew, setModelsAddingNew] = useState(false);
  const [modelsNewValue, setModelsNewValue] = useState('');
  const [status, setStatus] = useState('');

  const activeField: FieldName = FIELDS[activeFieldIndex] ?? 'name';

  useEffect(() => {
    if (form.type === 'custom-api' && !form.customApiModes) {
      setForm((f) => ({ ...f, customApiModes: { openai: false, anthropic: false, responses: false } }));
    }
  }, [form.type]);

  const doSubmit = useCallback(() => {
    const models = form.models.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
    try {
      validateProvider(
        { name: form.name, type: form.type, apiKey: form.apiKey, baseUrl: form.baseUrl, models, customApiModes: form.customApiModes ?? undefined },
        providers,
        provider?.id,
      );
      setStatus('Saving...');
      const result = onSubmit({ ...form, models, customApiModes: form.customApiModes ?? undefined });
      if (result instanceof Promise) {
        result.catch((err: unknown) => setStatus(`Error: ${String(err)}`));
      }
    } catch (err) {
      setStatus(String(err));
    }
  }, [form, providers, provider, onSubmit]);

  useKeyInput((input, key) => {
    if (subMode === 'models') {
      if (key.escape) {
        if (modelsEditingIndex !== null) { setModelsEditingIndex(null); return; }
        if (modelsAddingNew) { setModelsAddingNew(false); return; }
        setSubMode('form');
        return;
      }

      if (modelsEditingIndex !== null || modelsAddingNew) {
        return;
      }

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

      if (key.return) {
        if (modelsListIndex < form.models.length) {
          setModelsEditingIndex(modelsListIndex);
        } else {
          setModelsAddingNew(true);
          setModelsNewValue('');
        }
        return;
      }

      return;
    }

    if (key.escape) {
      if (activeField === 'models' || activeField === 'save') {
        setActiveFieldIndex((i) => Math.max(0, i - 1));
        return;
      }
      onCancel();
      return;
    }

    if (activeField === 'models' && key.return) {
      setSubMode('models');
      setModelsListIndex(0);
      setModelsEditingIndex(null);
      setModelsAddingNew(false);
      return;
    }

    if (activeField === 'customApiModes' && form.customApiModes) {
      if (input === 'o') {
        setForm((f) => f.customApiModes ? ({ ...f, customApiModes: { ...f.customApiModes, openai: !f.customApiModes.openai } }) : f);
        return;
      }
      if (input === 'a') {
        setForm((f) => f.customApiModes ? ({ ...f, customApiModes: { ...f.customApiModes, anthropic: !f.customApiModes.anthropic } }) : f);
        return;
      }
      if (input === 'r') {
        setForm((f) => f.customApiModes ? ({ ...f, customApiModes: { ...f.customApiModes, responses: !f.customApiModes.responses } }) : f);
        return;
      }
    }

    if ((key.tab && key.shift) || key.upArrow) {
      setActiveFieldIndex((i) => (i - 1 + FIELDS.length) % FIELDS.length);
      return;
    }
    if ((key.tab && !key.shift) || key.downArrow) {
      setActiveFieldIndex((i) => (i + 1) % FIELDS.length);
      return;
    }

    if (activeField === 'type') {
      if (key.return || input === ' ' || key.leftArrow || key.rightArrow) {
        const currentIndex = PROVIDER_TYPES.indexOf(form.type);
        const nextIndex = key.leftArrow
          ? (currentIndex - 1 + PROVIDER_TYPES.length) % PROVIDER_TYPES.length
          : (currentIndex + 1) % PROVIDER_TYPES.length;
        setForm((f) => ({ ...f, type: PROVIDER_TYPES[nextIndex]! }));
        return;
      }
    }

    if (activeField === 'save' && key.return) {
      doSubmit();
      return;
    }
  });

  if (subMode === 'models') {
    const inEdit = modelsEditingIndex !== null || modelsAddingNew;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Edit Models</Text>
        <Text dimColor>
          {inEdit ? 'Enter: save  Esc: cancel' : '↑↓: navigate  Enter: edit/add  i/v/a: toggle caps  d: delete  Esc: back'}
        </Text>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {form.models.length === 0 && !modelsAddingNew && (
            <Text dimColor>(no models)</Text>
          )}
          {form.models.map((model, idx) => (
            <Box key={idx}>
              <Text color="cyan">
                {modelsListIndex === idx && !inEdit ? '▶ ' : '  '}
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
                <Text><Text color="gray">{capabilityMarker(model.capabilities)} </Text>{model.name}</Text>
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
              color={modelsListIndex === form.models.length ? 'green' : 'cyan'}
              dimColor={modelsListIndex !== form.models.length}
            >
              {modelsListIndex === form.models.length ? '▶ ' : '  '}[+ add model]
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  const inCustomModes = activeField === 'customApiModes';
  const hint = activeField === 'models'
    ? 'Enter: edit models  Tab: next field  Esc: back'
    : activeField === 'save'
      ? 'Enter: save provider  Esc: back  Tab: navigate'
      : inCustomModes
        ? 'o/a/r: toggle modes  Tab: navigate  Esc: cancel'
        : 'Tab/↑↓: navigate  Space/←→: toggle type  Esc: cancel';

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{provider ? 'Edit Provider' : 'Add Provider'}</Text>
      {status && <Text color={status.startsWith('Error') ? 'red' : status === 'Saving...' ? 'cyan' : 'yellow'}>{status}</Text>}
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
                {field === 'save' && (
                  <Text color={focused ? 'green' : 'gray'} bold={focused}>{focused ? '[ Save ]' : '  Save  '}</Text>
                )}
                {field !== 'type' && field !== 'models' && field !== 'customApiModes' && field !== 'save' && (
                  <TextInput
                    value={form[field as StringField]}
                    onChange={(value) => setForm((f) => ({ ...f, [field]: value }))}
                    focus={focused}
                    showCursor={focused}
                    placeholder={field === 'baseUrl'
                      ? (form.type === 'custom-api'
                        ? '(required, /v1/ stripped automatically)'
                        : ['openai-compatible','responses-compatible'].includes(form.type)
                          ? '(required)'
                          : '(optional)')
                      : ''}
                  />
                )}
              </Box>
              {field === 'customApiModes' && (
                <Box flexDirection="column" paddingLeft={4}>
                  {form.customApiModes ? (
                    <>
                      <Text dimColor={!focused}>
                        <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>
                        [{form.customApiModes.openai ? 'x' : ' '}] openai
                      </Text>
                      <Text dimColor={!focused}>
                        <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>
                        [{form.customApiModes.anthropic ? 'x' : ' '}] anthropic
                      </Text>
                      <Text dimColor={!focused}>
                        <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>
                        [{form.customApiModes.responses ? 'x' : ' '}] responses
                      </Text>
                    </>
                  ) : (
                    <Text dimColor>(not applicable for this provider type)</Text>
                  )}
                </Box>
              )}
              {field === 'models' && (
                <Box flexDirection="column" paddingLeft={4}>
                  {form.models.length === 0 && (
                    <Text dimColor>(no models)</Text>
                  )}
                  {form.models.map((model, idx) => (
                    <Box key={idx}>
                      <Text dimColor={!focused}><Text color="gray">{capabilityMarker(model.capabilities)} </Text>{model.name}</Text>
                    </Box>
                  ))}
                  <Text
                    color={focused && modelsListIndex === form.models.length ? 'green' : 'cyan'}
                    dimColor={!(focused && modelsListIndex === form.models.length)}
                  >
                    {focused && modelsListIndex === form.models.length ? '▶ ' : '  '}[+ add model]
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
