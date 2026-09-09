import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useKeyInput } from '../use-key-input.js';
import type { Provider, ModelConfig, ProviderType } from '../../config/schema.js';
import { capabilityMarker, PROVIDER_TYPES } from '../../config/schema.js';
import { validateProvider } from '../../config/validation.js';
import { isOpenAICompatible, resolveModelsBaseUrl, fetchProviderModels } from '../provider-api.js';

/** All possible field names, including conditional API-test fields. */
type FieldName =
  | 'name'
  | 'type'
  | 'apiKey'
  | 'baseUrl'
  | 'customApiModes'
  | 'models'
  | 'apiTest'
  | 'fetchModels'
  | 'save';

/** Text-input fields that map directly to string form state keys. */
type StringField = 'name' | 'apiKey' | 'baseUrl';

/** Active screen within the provider form. */
type SubMode = 'form' | 'models' | 'model-selection';

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

/** How many fetched models are visible at once in the selection list. */
const MODEL_VIEWPORT = 20;

interface ProviderFormProps {
  provider?: Provider;
  providers: Provider[];
  onSubmit: (data: {
    name: string;
    type: ProviderType;
    apiKey: string;
    baseUrl?: string;
    customApiModes?: { openai: boolean; anthropic: boolean; responses: boolean };
    models: ModelConfig[];
  }) => Promise<void> | void;
  onCancel: () => void;
}

/** Returns the left-column label for each field. */
function labelFor(f: FieldName): string {
  switch (f) {
    case 'name':
      return 'Name:    ';
    case 'type':
      return 'Type:    ';
    case 'apiKey':
      return 'API Key: ';
    case 'baseUrl':
      return 'Base URL:';
    case 'customApiModes':
      return 'API Modes:';
    case 'models':
      return 'Models:  ';
    case 'apiTest':
      return 'API:     ';
    case 'fetchModels':
      return 'Fetch:   ';
    case 'save':
      return 'Save:    ';
  }
}

export function ProviderForm({
  provider,
  providers,
  onSubmit,
  onCancel,
}: ProviderFormProps): React.JSX.Element {
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
  const [subMode, setSubMode] = useState<SubMode>('form');
  const [modelsListIndex, setModelsListIndex] = useState(0);
  const [modelsEditingIndex, setModelsEditingIndex] = useState<number | null>(null);
  const [modelsAddingNew, setModelsAddingNew] = useState(false);
  const [modelsNewValue, setModelsNewValue] = useState('');
  const [status, setStatus] = useState('');

  // --- API test state ---
  const [apiTestStatus, setApiTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>(
    'idle',
  );
  const [apiTestError, setApiTestError] = useState('');
  const [cachedModels, setCachedModels] = useState<string[]>([]);

  // --- Model-selection sub-mode state ---
  const [modelSelectionCursor, setModelSelectionCursor] = useState(0);
  const [modelSelectionSelected, setModelSelectionSelected] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState('');

  /** The fetched list narrowed by the typing filter; what the selection UI shows. */
  const filteredModels = useMemo(
    () => cachedModels.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase())),
    [cachedModels, modelFilter],
  );

  /** Ref to the in-flight AbortController so we can cancel stale requests. */
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Snapshot of the form as it was when opened; used to detect unsaved edits. */
  const initialSnapshot = useRef(JSON.stringify(form));
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Sync customApiModes when type switches to custom-api.
  useEffect(() => {
    if (form.type === 'custom-api' && !form.customApiModes) {
      setForm((f) => ({
        ...f,
        customApiModes: { openai: false, anthropic: false, responses: false },
      }));
    }
  }, [form.type]);

  // Reset API-test state whenever credentials or type change.
  useEffect(() => {
    setApiTestStatus('idle');
    setApiTestError('');
    setCachedModels([]);
  }, [form.apiKey, form.baseUrl, form.type]);

  /**
   * Dynamically computed field list.
   * - `customApiModes` shown only for custom-api type.
   * - `apiTest` shown for all OpenAI-compatible types.
   * - `fetchModels` shown only after a successful API test.
   */
  const fields: FieldName[] = useMemo(() => {
    const f: FieldName[] = ['name', 'type', 'apiKey', 'baseUrl'];
    if (form.type === 'custom-api') f.push('customApiModes');
    f.push('models');
    if (isOpenAICompatible(form.type)) {
      f.push('apiTest');
      if (apiTestStatus === 'success') f.push('fetchModels');
    }
    f.push('save');
    return f;
  }, [form.type, apiTestStatus]);

  // Clamp cursor to valid range whenever the fields array shrinks.
  useEffect(() => {
    setActiveFieldIndex((i) => Math.min(i, fields.length - 1));
  }, [fields.length]);

  const activeField: FieldName = fields[activeFieldIndex] ?? 'name';

  /** Tests the API by fetching /models; caches model list on success. */
  const doTest = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setApiTestStatus('testing');
    setApiTestError('');

    const result = await fetchProviderModels(
      resolveModelsBaseUrl(form.type, form.baseUrl),
      form.apiKey,
      controller.signal,
    );

    if (controller.signal.aborted) return;

    if (result.ok) {
      setCachedModels(result.models);
      setApiTestStatus('success');
    } else {
      setApiTestError(result.error);
      setApiTestStatus('error');
    }
  }, [form.type, form.baseUrl, form.apiKey]);

  const isDirty = useCallback(
    (): boolean => JSON.stringify(form) !== initialSnapshot.current,
    [form],
  );

  const doSubmit = useCallback(() => {
    const models = form.models.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
    try {
      validateProvider(
        {
          name: form.name,
          type: form.type,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          models,
          customApiModes: form.customApiModes ?? undefined,
        },
        providers,
        provider?.id,
      );
      setStatus('Saving...');
      const result = onSubmit({
        ...form,
        models,
        customApiModes: form.customApiModes ?? undefined,
      });
      if (result instanceof Promise) {
        result.catch((err: unknown) => setStatus(`Error: ${String(err)}`));
      }
    } catch (err) {
      setStatus(String(err));
    }
  }, [form, providers, provider, onSubmit]);

  useKeyInput((input, key) => {
    // --- model-selection sub-mode ---
    if (subMode === 'model-selection') {
      if (key.escape) {
        setSubMode('form');
        return;
      }
      if (key.pageDown) {
        setModelSelectionCursor((i) => Math.min(filteredModels.length - 1, i + MODEL_VIEWPORT));
        return;
      }
      if (key.pageUp) {
        setModelSelectionCursor((i) => Math.max(0, i - MODEL_VIEWPORT));
        return;
      }
      // Terminals report the Backspace key as either 0x7f (delete) or Ctrl+H.
      if (key.backspace || key.delete) {
        setModelFilter((f) => f.slice(0, -1));
        setModelSelectionCursor(0);
        return;
      }
      if (input === ' ') {
        const modelId = filteredModels[modelSelectionCursor];
        if (modelId !== undefined) {
          setModelSelectionSelected((prev) => {
            const next = new Set(prev);
            if (next.has(modelId)) next.delete(modelId);
            else next.add(modelId);
            return next;
          });
        }
        return;
      }
      if (
        input.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        !key.upArrow &&
        !key.downArrow &&
        input >= ' ' &&
        input <= '~'
      ) {
        setModelFilter((f) => f + input);
        setModelSelectionCursor(0);
        return;
      }
      if (key.upArrow) {
        setModelSelectionCursor((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setModelSelectionCursor((i) => Math.min(filteredModels.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const existingNames = new Set(form.models.map((m) => m.name));
        const toAdd = [...modelSelectionSelected]
          .filter((id) => !existingNames.has(id))
          .map((id): ModelConfig => ({
            name: id,
            capabilities: { image: true, video: false, audio: false },
          }));
        if (toAdd.length > 0) {
          setForm((f) => ({ ...f, models: [...f.models, ...toAdd] }));
        }
        setSubMode('form');
        return;
      }
      return;
    }

    // --- models sub-mode ---
    if (subMode === 'models') {
      if (key.escape) {
        if (modelsEditingIndex !== null) {
          setModelsEditingIndex(null);
          return;
        }
        if (modelsAddingNew) {
          setModelsAddingNew(false);
          return;
        }
        setSubMode('form');
        return;
      }

      if (modelsEditingIndex !== null || modelsAddingNew) {
        return;
      }

      if (key.upArrow) {
        setModelsListIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setModelsListIndex((i) => Math.min(form.models.length, i + 1));
        return;
      }

      if (modelsListIndex < form.models.length) {
        if (input === 'i') {
          setForm((f) => ({
            ...f,
            models: f.models.map((m, j) =>
              j === modelsListIndex
                ? { ...m, capabilities: { ...m.capabilities, image: !m.capabilities.image } }
                : m,
            ),
          }));
          return;
        }
        if (input === 'v') {
          setForm((f) => ({
            ...f,
            models: f.models.map((m, j) =>
              j === modelsListIndex
                ? { ...m, capabilities: { ...m.capabilities, video: !m.capabilities.video } }
                : m,
            ),
          }));
          return;
        }
        if (input === 'a') {
          setForm((f) => ({
            ...f,
            models: f.models.map((m, j) =>
              j === modelsListIndex
                ? { ...m, capabilities: { ...m.capabilities, audio: !m.capabilities.audio } }
                : m,
            ),
          }));
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

    // --- form sub-mode ---
    if (confirmDiscard) {
      const lower = input.toLowerCase();
      if (key.return || lower === 'y') {
        onCancel();
      } else if (key.escape || lower === 'n') {
        setConfirmDiscard(false);
      }
      return;
    }

    if (key.escape) {
      if (isDirty()) {
        setConfirmDiscard(true);
        return;
      }
      onCancel();
      return;
    }

    if (activeField === 'models' && key.return) {
      if (isOpenAICompatible(form.type) && apiTestStatus !== 'success') {
        setStatus('Test the API first (the "API:" field) before editing models');
        return;
      }
      setStatus('');
      setSubMode('models');
      setModelsListIndex(0);
      setModelsEditingIndex(null);
      setModelsAddingNew(false);
      return;
    }

    if (activeField === 'apiTest' && key.return) {
      if (apiTestStatus !== 'testing') void doTest();
      return;
    }

    if (activeField === 'fetchModels' && key.return) {
      setModelSelectionCursor(0);
      setModelSelectionSelected(new Set());
      setModelFilter('');
      setSubMode('model-selection');
      return;
    }

    if (activeField === 'customApiModes' && form.customApiModes) {
      if (input === 'o') {
        setForm((f) =>
          f.customApiModes
            ? { ...f, customApiModes: { ...f.customApiModes, openai: !f.customApiModes.openai } }
            : f,
        );
        return;
      }
      if (input === 'a') {
        setForm((f) =>
          f.customApiModes
            ? {
                ...f,
                customApiModes: { ...f.customApiModes, anthropic: !f.customApiModes.anthropic },
              }
            : f,
        );
        return;
      }
      if (input === 'r') {
        setForm((f) =>
          f.customApiModes
            ? {
                ...f,
                customApiModes: { ...f.customApiModes, responses: !f.customApiModes.responses },
              }
            : f,
        );
        return;
      }
    }

    if ((key.tab && key.shift) || key.upArrow) {
      setActiveFieldIndex((i) => (i - 1 + fields.length) % fields.length);
      return;
    }
    if ((key.tab && !key.shift) || key.downArrow) {
      setActiveFieldIndex((i) => (i + 1) % fields.length);
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

  // --- discard-confirmation dialog ---
  if (confirmDiscard) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Unsaved changes</Text>
        <Text>Discard changes? y/Enter: discard | n/Esc: keep editing</Text>
      </Box>
    );
  }

  // --- model-selection sub-mode render ---
  if (subMode === 'model-selection') {
    const cursor = Math.min(modelSelectionCursor, Math.max(0, filteredModels.length - 1));
    const total = filteredModels.length;
    const viewStart = Math.max(
      0,
      Math.min(cursor - Math.floor(MODEL_VIEWPORT / 2), total - MODEL_VIEWPORT),
    );
    const viewEnd = Math.min(total, viewStart + MODEL_VIEWPORT);
    const visibleModels = filteredModels.slice(viewStart, viewEnd);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Select Models</Text>
        <Text dimColor>
          type: filter | Backspace: edit | ↑↓: navigate Space: toggle Enter: add Esc: back
        </Text>
        <Text dimColor>
          Selected: {modelSelectionSelected.size} [{cursor + 1}/{total}]
          {modelFilter ? `  Filter: "${modelFilter}" of ${cachedModels.length}` : ''}
        </Text>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {total === 0 && <Text dimColor>(no models match the filter)</Text>}
          {viewStart > 0 && <Text dimColor> ↑ {viewStart} more</Text>}
          {visibleModels.map((modelId, relIdx) => {
            const idx = viewStart + relIdx;
            const isCursor = idx === cursor;
            const isChecked = modelSelectionSelected.has(modelId);
            const alreadyAdded = form.models.some((m) => m.name === modelId);
            return (
              <Box key={modelId}>
                <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '▶ ' : '  '}</Text>
                <Text dimColor={alreadyAdded}>
                  [{isChecked ? 'x' : ' '}] {modelId}
                  {alreadyAdded ? ' (already added)' : ''}
                </Text>
              </Box>
            );
          })}
          {viewEnd < total && <Text dimColor> ↓ {total - viewEnd} more</Text>}
        </Box>
      </Box>
    );
  }

  // --- models sub-mode render ---
  if (subMode === 'models') {
    const inEdit = modelsEditingIndex !== null || modelsAddingNew;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Edit Models</Text>
        <Text dimColor>
          {inEdit
            ? 'Enter: save  Esc: cancel'
            : '↑↓: navigate  Enter: edit/add  i/v/a: toggle caps  d: delete  Esc: back'}
        </Text>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {form.models.length === 0 && !modelsAddingNew && <Text dimColor>(no models)</Text>}
          {form.models.map((model, idx) => (
            <Box key={idx}>
              <Text color="cyan">{modelsListIndex === idx && !inEdit ? '▶ ' : '  '}</Text>
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
                <Text>
                  <Text color="gray">{capabilityMarker(model.capabilities)} </Text>
                  {model.name}
                </Text>
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
                  if (trimmed)
                    setForm((f) => ({
                      ...f,
                      models: [
                        ...f.models,
                        {
                          name: trimmed,
                          capabilities: { image: true, video: false, audio: false },
                        },
                      ],
                    }));
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

  // --- form sub-mode render ---
  const hint =
    activeField === 'models'
      ? 'Enter: edit models  Tab: next field  Esc: cancel'
      : activeField === 'save'
        ? 'Enter: save provider  Esc: cancel  Tab: navigate'
        : activeField === 'customApiModes'
          ? 'o/a/r: toggle modes  Tab: navigate  Esc: cancel'
          : activeField === 'apiTest'
            ? 'Enter: test API  Tab: next field'
            : activeField === 'fetchModels'
              ? 'Enter: fetch model list  Tab: next field'
              : 'Tab/↑↓: navigate  Space/←→: toggle type  Esc: cancel';

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{provider ? 'Edit Provider' : 'Add Provider'}</Text>
      {status && (
        <Text
          color={status.startsWith('Error') ? 'red' : status === 'Saving...' ? 'cyan' : 'yellow'}
        >
          {status}
        </Text>
      )}
      <Text dimColor>{hint}</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((field, i) => {
          const focused = i === activeFieldIndex;
          const labelColor = focused ? 'green' : 'white';
          return (
            <Box key={field} flexDirection="column">
              <Box>
                <Text color={labelColor}>
                  {focused ? '▶ ' : '  '}
                  {labelFor(field)}{' '}
                </Text>
                {field === 'type' && (
                  <Text>
                    {focused ? '◀ ' : '  '}
                    {form.type}
                    {focused ? ' ▶' : ''}
                  </Text>
                )}
                {field === 'save' && (
                  <Text color={focused ? 'green' : 'gray'} bold={focused}>
                    {focused ? '[ Save ]' : '  Save  '}
                  </Text>
                )}
                {field === 'apiTest' && (
                  <Box>
                    <Text
                      color={
                        apiTestStatus === 'success'
                          ? 'green'
                          : apiTestStatus === 'error'
                            ? 'red'
                            : focused
                              ? 'green'
                              : 'gray'
                      }
                      bold={focused}
                    >
                      {focused ? '[ Test API ]' : ' Test API '}
                    </Text>
                    {apiTestStatus === 'testing' && <Text color="cyan"> Testing...</Text>}
                    {apiTestStatus === 'success' && (
                      <Text color="green"> ✓ OK — {cachedModels.length} models</Text>
                    )}
                    {apiTestStatus === 'error' && <Text color="red"> ✗ {apiTestError}</Text>}
                  </Box>
                )}
                {field === 'fetchModels' && (
                  <Text color={focused ? 'green' : 'gray'} bold={focused}>
                    {focused ? '[ Fetch model list ]' : '  Fetch model list  '}
                  </Text>
                )}
                {field !== 'type' &&
                  field !== 'models' &&
                  field !== 'customApiModes' &&
                  field !== 'save' &&
                  field !== 'apiTest' &&
                  field !== 'fetchModels' && (
                    <TextInput
                      value={form[field as StringField]}
                      onChange={(value) => setForm((f) => ({ ...f, [field]: value }))}
                      focus={focused}
                      showCursor={focused}
                      placeholder={
                        field === 'baseUrl'
                          ? form.type === 'custom-api'
                            ? '(required, /v1/ stripped automatically)'
                            : form.type === 'responses-compatible'
                              ? '(required)'
                              : form.type === 'openai-compatible'
                                ? '(optional, default: https://api.openai.com/v1)'
                                : '(optional)'
                          : ''
                      }
                    />
                  )}
              </Box>
              {field === 'customApiModes' && form.customApiModes && (
                <Box flexDirection="column" paddingLeft={4}>
                  <Text dimColor={!focused}>
                    <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>[
                    {form.customApiModes.openai ? 'x' : ' '}] openai
                  </Text>
                  <Text dimColor={!focused}>
                    <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>[
                    {form.customApiModes.anthropic ? 'x' : ' '}] anthropic
                  </Text>
                  <Text dimColor={!focused}>
                    <Text color={focused ? 'cyan' : undefined}>{focused ? '▶ ' : '  '}</Text>[
                    {form.customApiModes.responses ? 'x' : ' '}] responses
                  </Text>
                </Box>
              )}
              {field === 'models' && (
                <Box flexDirection="column" paddingLeft={4}>
                  {form.models.length === 0 && <Text dimColor>(no models)</Text>}
                  {form.models.map((model, idx) => (
                    <Box key={idx}>
                      <Text dimColor={!focused}>
                        <Text color="gray">{capabilityMarker(model.capabilities)} </Text>
                        {model.name}
                      </Text>
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
