import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { ProviderList } from './ProviderList.js';
import { ProviderForm } from './ProviderForm.js';
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
} from '../../providers/provider-manager.js';
import type { Provider } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'edit' | 'confirm-delete';

interface ProvidersProps {
  onBack: () => void;
}

/** Ink component for managing API providers (list, add, edit, delete). */
export function Providers({ onBack }: ProvidersProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [editTarget, setEditTarget] = useState<Provider | null>(null);
  const [status, setStatus] = useState('');

  const reload = useCallback(() => {
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useKeyInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') {
        onBack();
        return;
      }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(providers.length, i + 1));
      else if (input === 'a') {
        setStatus('');
        setMode('add');
      } else if (input === 'e' && providers[selectedIndex]) {
        setEditTarget(providers[selectedIndex]!);
        setStatus('');
        setMode('edit');
      } else if (input === 'd' && providers[selectedIndex]) {
        setDeleteTarget(providers[selectedIndex] ?? null);
        setMode('confirm-delete');
      } else if (key.return && selectedIndex === providers.length) {
        setStatus('');
        setMode('add');
      }
      return;
    }

    if (mode === 'confirm-delete') {
      if (input === 'y' && deleteTarget) {
        removeProvider(deleteTarget.id)
          .then(() => {
            setStatus(`Deleted "${deleteTarget.name}"`);
            reload();
            setMode('list');
          })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
      return;
    }
  });

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          Delete provider <Text bold>"{deleteTarget?.name}"</Text>? Press y to confirm, any other
          key to cancel.
        </Text>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <ProviderForm
        providers={providers}
        onSubmit={(data) => {
          return addProvider(data)
            .then((p) => {
              setStatus(`Added "${p.name}"`);
              reload();
              setMode('list');
            })
            .catch((err) => {
              setStatus(`Error: ${String(err)}`);
              throw err;
            });
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'edit' && editTarget) {
    return (
      <ProviderForm
        provider={editTarget}
        providers={providers}
        onSubmit={(data) => {
          return updateProvider(editTarget.id, data)
            .then(() => {
              setStatus('Saved');
              reload();
              setMode('list');
            })
            .catch((err) => {
              setStatus(`Error: ${String(err)}`);
              throw err;
            });
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  return (
    <ProviderList
      providers={providers}
      selected={selectedIndex}
      onSelect={setSelectedIndex}
      onAdd={() => {
        setStatus('');
        setMode('add');
      }}
      onEdit={() => {
        if (providers[selectedIndex]) {
          setEditTarget(providers[selectedIndex]!);
          setStatus('');
          setMode('edit');
        }
      }}
      onDelete={() => {
        if (providers[selectedIndex]) {
          setDeleteTarget(providers[selectedIndex] ?? null);
          setMode('confirm-delete');
        }
      }}
      onBack={onBack}
      status={status}
    />
  );
}
