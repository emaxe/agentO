import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { ProviderList, type ProviderTestStatus } from './ProviderList.js';
import { ProviderForm } from './ProviderForm.js';
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
} from '../../providers/provider-manager.js';
import { fetchProviderModels, isOpenAICompatible, resolveModelsBaseUrl } from '../provider-api.js';
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
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, ProviderTestStatus>>({});
  const help = useHelp();

  const reload = useCallback(() => {
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const lower = query.trim().toLowerCase();
  const filteredProviders = lower
    ? providers.filter((provider) =>
        `${provider.name} ${provider.type} ${provider.baseUrl ?? ''} ${provider.models
          .map((model) => model.name)
          .join(' ')}`
          .toLowerCase()
          .includes(lower),
      )
    : providers;

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, filteredProviders.length));
  }, [query, providers.length, filteredProviders.length]);

  const testProvider = useCallback((provider: Provider) => {
    if (!isOpenAICompatible(provider.type)) {
      setTestStatus((prev) => ({
        ...prev,
        [provider.id]: {
          state: 'error',
          message: 'not available for this provider type',
        },
      }));
      return;
    }

    setTestStatus((prev) => ({
      ...prev,
      [provider.id]: { state: 'testing', message: 'testing...' },
    }));
    fetchProviderModels(
      resolveModelsBaseUrl(provider.type, provider.baseUrl ?? ''),
      provider.apiKey,
    )
      .then((result) => {
        setTestStatus((prev) => ({
          ...prev,
          [provider.id]: result.ok
            ? { state: 'ok', message: `OK — ${result.models.length} models` }
            : { state: 'error', message: result.error },
        }));
      })
      .catch((err: unknown) => {
        setTestStatus((prev) => ({
          ...prev,
          [provider.id]: { state: 'error', message: String(err) },
        }));
      });
  }, []);

  const duplicateProvider = useCallback(
    (provider: Provider) => {
      const baseName = `${provider.name} copy`;
      let name = baseName;
      for (let n = 2; providers.some((candidate) => candidate.name === name); n++) {
        name = `${baseName} ${n}`;
      }
      addProvider({
        name,
        type: provider.type,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        customApiModes: provider.customApiModes,
        models: provider.models.map((model) => ({
          ...model,
          capabilities: { ...model.capabilities },
        })),
      })
        .then((copy) => {
          setStatus(`Duplicated "${provider.name}" as "${copy.name}"`);
          setQuery('');
          setSearchOpen(false);
          reload();
        })
        .catch((err) => setStatus(`Error: ${String(err)}`));
    },
    [providers, reload],
  );

  useKeyInput((input, key) => {
    if (mode === 'list' && !searchOpen && help.handleKey(input, key)) return;

    if (mode === 'list' && searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        setQuery('');
        return;
      }
      if (key.return) {
        setSearchOpen(false);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(Math.max(0, filteredProviders.length - 1), i + 1));
        return;
      }
      if (
        input.length > 0 &&
        !key.ctrl &&
        !key.meta &&
        [...input].every((char) => char >= ' ' && char <= '~')
      ) {
        setQuery((q) => q + input);
        setSelectedIndex(0);
        return;
      }
      return;
    }

    if (mode === 'list') {
      if (key.escape || input === 'q') {
        if (query) {
          setQuery('');
          setSelectedIndex(0);
          return;
        }
        onBack();
        return;
      }
      if (input === '/') {
        setSearchOpen(true);
        return;
      }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(filteredProviders.length, i + 1));
      } else if (input === 'a') {
        setStatus('');
        setMode('add');
      } else if (key.return && filteredProviders[selectedIndex]) {
        setEditTarget(filteredProviders[selectedIndex]!);
        setStatus('');
        setMode('edit');
      } else if (input === 'e' && filteredProviders[selectedIndex]) {
        setEditTarget(filteredProviders[selectedIndex]!);
        setStatus('');
        setMode('edit');
      } else if (input === 'd' && filteredProviders[selectedIndex]) {
        setDeleteTarget(filteredProviders[selectedIndex] ?? null);
        setMode('confirm-delete');
      } else if (input === 't' && filteredProviders[selectedIndex]) {
        testProvider(filteredProviders[selectedIndex]!);
      } else if (input === 'c' && filteredProviders[selectedIndex]) {
        duplicateProvider(filteredProviders[selectedIndex]!);
      } else if (key.return && selectedIndex === filteredProviders.length) {
        setStatus('');
        setMode('add');
      }
      return;
    }

    if (mode === 'confirm-delete') {
      const lowerInput = input.toLowerCase();
      if ((key.return || lowerInput === 'y') && deleteTarget) {
        removeProvider(deleteTarget.id)
          .then(() => {
            setStatus(`Deleted "${deleteTarget.name}"`);
            setQuery('');
            setSearchOpen(false);
            reload();
            setMode('list');
          })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else if (key.escape || lowerInput === 'n' || input === 'q') {
        setMode('list');
      }
      return;
    }
  });

  if (help.open) {
    return <HelpOverlay topic="providers" />;
  }

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          Delete provider <Text bold>"{deleteTarget?.name}"</Text>? y/Enter: confirm | n/Esc: cancel
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
              setQuery('');
              setSearchOpen(false);
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
              setQuery('');
              setSearchOpen(false);
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
      providers={filteredProviders}
      selected={selectedIndex}
      filter={query}
      searchOpen={searchOpen}
      testStatus={testStatus}
      onSelect={setSelectedIndex}
      onAdd={() => {
        setStatus('');
        setMode('add');
      }}
      onEdit={() => {
        if (filteredProviders[selectedIndex]) {
          setEditTarget(filteredProviders[selectedIndex]!);
          setStatus('');
          setMode('edit');
        }
      }}
      onDelete={() => {
        if (filteredProviders[selectedIndex]) {
          setDeleteTarget(filteredProviders[selectedIndex] ?? null);
          setMode('confirm-delete');
        }
      }}
      onBack={onBack}
      status={status}
    />
  );
}
