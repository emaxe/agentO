import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import TextInput from 'ink-text-input';
import { listProviders, addProvider, updateProvider, removeProvider } from '../../providers/provider-manager.js';
import type { Provider, ModelConfig } from '../../config/schema.js';
import { capabilityMarker } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'edit' | 'confirm-delete';
type FieldName = 'name' | 'type' | 'apiKey' | 'baseUrl' | 'models';
type StringField = 'name' | 'apiKey' | 'baseUrl';

interface ProvidersProps {
  onBack: () => void;
}

interface FormState {
  name: string;
  type: 'openai-compatible' | 'anthropic' | 'fireworks';
  apiKey: string;
  baseUrl: string;
  models: ModelConfig[];
}

const FIELDS: FieldName[] = ['name', 'type', 'apiKey', 'baseUrl', 'models'];
const INITIAL_FORM: FormState = {
  name: '',
  type: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  models: [],
};

export function Providers({ onBack }: ProvidersProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [editTarget, setEditTarget] = useState<Provider | null>(null);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [modelsListIndex, setModelsListIndex] = useState(0);
  const [modelsEditingIndex, setModelsEditingIndex] = useState<number | null>(null);
  const [modelsAddingNew, setModelsAddingNew] = useState(false);
  const [modelsNewValue, setModelsNewValue] = useState('');

  const reload = useCallback(() => {
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const activeField: FieldName = FIELDS[activeFieldIndex] ?? 'name';

  useEffect(() => {
    if (activeField !== 'models') {
      setModelsEditingIndex(null);
      setModelsAddingNew(false);
    }
  }, [activeField]);

  useEffect(() => {
    setModelsEditingIndex(null);
    setModelsAddingNew(false);
    setModelsListIndex(0);
  }, [mode]);

  const submitEdit = useCallback(() => {
    if (!editTarget) return;
    const models = form.models.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
    if (!form.name || !form.apiKey || models.length === 0) {
      setStatus('Name, API key and at least one model required');
      return;
    }
    updateProvider(editTarget.id, {
      name: form.name,
      type: form.type,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl || undefined,
      models,
    }).then(() => {
      setStatus('Saved');
      reload();
      setMode('list');
    }).catch((err) => setStatus(`Error: ${String(err)}`));
  }, [editTarget, form, reload]);

  const submitForm = useCallback(() => {
    const models = form.models.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
    if (!form.name || !form.apiKey || models.length === 0) {
      setStatus('Name, API key and at least one model required');
      return;
    }
    addProvider({
      name: form.name,
      type: form.type,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl || undefined,
      models,
    }).then((p) => {
      setStatus(`Added "${p.name}"`);
      reload();
      setMode('list');
    }).catch((err) => setStatus(`Error: ${String(err)}`));
  }, [form, reload]);

  useKeyInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(providers.length, i + 1));
      else if (input === 'a') {
        setMode('add');
        setForm(INITIAL_FORM);
        setActiveFieldIndex(0);
        setStatus('');
      }
      else if (input === 'e' && providers[selectedIndex]) {
        const p = providers[selectedIndex]!;
        setEditTarget(p);
        setForm({ name: p.name, type: p.type, apiKey: p.apiKey, baseUrl: p.baseUrl ?? '', models: p.models.map((m) => ({ ...m, capabilities: { ...m.capabilities } })) });
        setActiveFieldIndex(0);
        setStatus('');
        setMode('edit');
      }
      else if (input === 'd' && providers[selectedIndex]) {
        setDeleteTarget(providers[selectedIndex] ?? null);
        setMode('confirm-delete');
      }
      else if (key.return && selectedIndex === providers.length) {
        setMode('add');
        setForm(INITIAL_FORM);
        setActiveFieldIndex(0);
        setStatus('');
      }
      return;
    }

    if (mode === 'confirm-delete') {
      if (input === 'y' && deleteTarget) {
        removeProvider(deleteTarget.id)
          .then(() => { setStatus(`Deleted "${deleteTarget.name}"`); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
      return;
    }

    // mode is 'add' or 'edit'

    if (key.escape) {
      if (modelsEditingIndex !== null) { setModelsEditingIndex(null); return; }
      if (modelsAddingNew) { setModelsAddingNew(false); return; }
      setMode('list');
      return;
    }

    // When a models TextInput is active, block other key handling (TextInput handles input)
    if (activeField === 'models' && (modelsEditingIndex !== null || modelsAddingNew)) {
      return;
    }

    // Models list navigation (models field focused, not editing)
    if (activeField === 'models') {
      if (key.upArrow) { setModelsListIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelsListIndex((i) => Math.min(form.models.length, i + 1)); return; }
      // Capability toggles (only on real models, not [+ add] row)
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
      if (input === 'e' && form.models.length > 0 && modelsListIndex < form.models.length) { setModelsEditingIndex(modelsListIndex); return; }
      // Enter on [+ add model] row
      if (key.return && modelsListIndex === form.models.length) {
        setModelsAddingNew(true);
        setModelsNewValue('');
        return;
      }
      // Tab, Shift+Tab, Enter fall through to field navigation / submit below
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
        const types: Array<'openai-compatible' | 'anthropic' | 'fireworks'> = ['openai-compatible', 'anthropic', 'fireworks'];
        const currentIndex = types.indexOf(form.type);
        const nextIndex = (currentIndex + 1) % types.length;
        setForm((f) => ({ ...f, type: types[nextIndex]! }));
        return;
      }
    }

    // Submit on Enter when models field is focused (on a real model row, not [+ add])
    if (key.return && activeField === 'models' && modelsListIndex < form.models.length) {
      if (mode === 'add') submitForm();
      else submitEdit();
      return;
    }
  });

  const labelFor = (f: FieldName): string => {
    switch (f) {
      case 'name': return 'Name:    ';
      case 'type': return 'Type:    ';
      case 'apiKey': return 'API Key: ';
      case 'baseUrl': return 'Base URL:';
      case 'models': return 'Models:  ';
    }
  };

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Delete provider <Text bold>"{deleteTarget?.name}"</Text>? Press y to confirm, any other key to cancel.</Text>
      </Box>
    );
  }

  if (mode === 'edit' || mode === 'add') {
    const inModelsEdit = modelsEditingIndex !== null || modelsAddingNew;
    const hint = inModelsEdit
      ? 'Enter: save item  Esc: cancel'
      : activeField === 'models'
        ? '↑↓: navigate  i/v/a: toggle caps  d: del  e: edit  Enter: add/save'
        : 'Tab/↑↓: navigate  Space/←→: toggle type  Enter: save  Esc: cancel';

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{mode === 'edit' ? 'Edit Provider' : 'Add Provider'}</Text>
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

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Providers</Text>
      <Text dimColor>↑↓ navigate | Enter/a: add | e: edit | d: delete | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {providers.map((p, i) => (
          <Box key={p.id} flexDirection="column">
            <Text color={i === selectedIndex ? 'green' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}{p.name} ({p.type})
            </Text>
            {i === selectedIndex && (
              <Box flexDirection="column" paddingLeft={3}>
                <Text dimColor>key: {p.apiKey.slice(0, 8)}...</Text>
                <Text dimColor>models: {p.models.map((m) => `${capabilityMarker(m.capabilities)} ${m.name}`).join(', ')}</Text>
                {p.baseUrl && <Text dimColor>url: {p.baseUrl}</Text>}
              </Box>
            )}
          </Box>
        ))}
        {providers.length === 0 && <Text dimColor>No providers. Press 'a' to add.</Text>}
        <Text color={selectedIndex === providers.length ? 'green' : 'cyan'}>
          {selectedIndex === providers.length ? '▶ ' : '  '}[+ Add provider]
        </Text>
      </Box>
    </Box>
  );
}
