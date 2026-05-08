import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { listProviders, addProvider, removeProvider } from '../../providers/provider-manager.js';
import type { Provider } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'confirm-delete';

interface ProvidersProps {
  onBack: () => void;
}

interface FormState {
  name: string;
  type: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseUrl: string;
  models: string;
  focusedField: number;
}

const FIELDS = ['name', 'type', 'apiKey', 'baseUrl', 'models'] as const;

export function Providers({ onBack }: ProvidersProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<FormState>({
    name: '', type: 'openai-compatible', apiKey: '', baseUrl: '', models: '',
    focusedField: 0,
  });

  const reload = useCallback(() => {
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(providers.length, i + 1));
      else if (input === 'a') { setMode('add'); setForm({ name: '', type: 'openai-compatible', apiKey: '', baseUrl: '', models: '', focusedField: 0 }); }
      else if (input === 'd' && providers[selectedIndex]) {
        setDeleteTarget(providers[selectedIndex] ?? null);
        setMode('confirm-delete');
      }
    } else if (mode === 'confirm-delete') {
      if (input === 'y' && deleteTarget) {
        removeProvider(deleteTarget.id)
          .then(() => { setStatus(`Deleted "${deleteTarget.name}"`); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
    } else if (mode === 'add') {
      if (key.escape) { setMode('list'); return; }
      if (key.tab || key.downArrow) { setForm((f) => ({ ...f, focusedField: (f.focusedField + 1) % FIELDS.length })); return; }
      if (key.upArrow) { setForm((f) => ({ ...f, focusedField: Math.max(0, f.focusedField - 1) })); return; }
      if (key.return && form.focusedField === FIELDS.length - 1) {
        // Submit
        const models = form.models.split(',').map((m) => m.trim()).filter(Boolean);
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
        return;
      }
      // Text input for focused field
      const field = FIELDS[form.focusedField];
      if (!field) return;
      if (key.backspace || key.delete) {
        setForm((f) => ({ ...f, [field]: (f[field] as string).slice(0, -1) }));
      } else if (!key.ctrl && !key.meta && input.length === 1) {
        if (field === 'type') {
          // Toggle type
          setForm((f) => ({ ...f, type: f.type === 'anthropic' ? 'openai-compatible' : 'anthropic' }));
        } else {
          setForm((f) => ({ ...f, [field]: (f[field] as string) + input }));
        }
      }
    }
  });

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Delete provider <Text bold>"{deleteTarget?.name}"</Text>? Press y to confirm, any other key to cancel.</Text>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Provider</Text>
        <Text dimColor>Tab/↑↓ to navigate fields, Enter on last field to submit, Esc to cancel</Text>
        <Box flexDirection="column" marginTop={1}>
          {FIELDS.map((field, i) => (
            <Box key={field}>
              <Text color={i === form.focusedField ? 'green' : 'white'}>{field}: </Text>
              <Text>
                {field === 'apiKey' && form.apiKey ? form.apiKey.slice(0, 4) + '...' : (form[field] as string)}
                {i === form.focusedField ? '█' : ''}
              </Text>
            </Box>
          ))}
        </Box>
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Providers</Text>
      <Text dimColor>↑↓ navigate | a: add | d: delete | Esc: back</Text>
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
                <Text dimColor>models: {p.models.join(', ')}</Text>
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
