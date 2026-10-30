import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useStableSelection } from '../use-stable-selection.js';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { readConfig } from '../../config/store.js';
import { StatusLine } from '../components/StatusLine.js';
import { ProviderList, type ProviderTestStatus } from './ProviderList.js';
import { ProviderForm } from './ProviderForm.js';
import { addProvider, updateProvider, removeProvider } from '../../providers/provider-manager.js';
import { fetchProviderModels, isOpenAICompatible, resolveModelsBaseUrl } from '../provider-api.js';
import type { Profile, Provider } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'edit' | 'confirm-delete';

interface ProvidersProps {
  onBack: () => void;
}

/** Ink component for managing API providers (list, add, edit, delete). */
export function Providers({ onBack }: ProvidersProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [deleting, setDeleting] = useState(false);
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
    readConfig()
      .then((config) => {
        setProviders(config.providers);
        setProfiles(config.profiles);
      })
      .catch((err) => setStatus(`Error: ${String(err)}`));
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

  useStableSelection(
    filteredProviders.map((item) => item.id),
    selectedIndex,
    setSelectedIndex,
  );

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
      [provider.id]: { state: 'testing', message: 'loading models...' },
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

  useKeyInput(
    (input, key) => {
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
          setQuery((q) => [...q].slice(0, -1).join(''));
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
          [...input].every(
            (char) => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127,
          )
        ) {
          const id = filteredProviders[selectedIndex]?.id;
          const nextQuery = query + input;
          setQuery(nextQuery);
          setSelectedIndex(
            Math.max(
              0,
              providers
                .filter((p) =>
                  `${p.name} ${p.type} ${p.baseUrl ?? ''} ${p.models.map((m) => m.name).join(' ')}`
                    .toLowerCase()
                    .includes(nextQuery.toLowerCase()),
                )
                .findIndex((p) => p.id === id),
            ),
          );
          return;
        }
        return;
      }

      if (mode === 'list') {
        if (key.escape || input === 'q') {
          if (query) {
            setQuery('');
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
          setStatus('');
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
        if (deleting) return;
        const lowerInput = input.toLowerCase();
        if ((key.return || lowerInput === 'y') && deleteTarget) {
          setDeleting(true);
          removeProvider(deleteTarget.id)
            .then(() => {
              setStatus(`Deleted "${deleteTarget.name}"`);
              setQuery('');
              setSearchOpen(false);
              reload();
              setMode('list');
            })
            .catch((err) => setStatus(`Error: ${String(err)}`))
            .finally(() => setDeleting(false));
        } else if (key.escape || lowerInput === 'n' || input === 'q') {
          setMode('list');
        }
        return;
      }
    },
    { textInput: searchOpen },
  );

  if (help.open) {
    return <HelpOverlay topic="providers" />;
  }

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          Delete provider <Text bold>"{deleteTarget?.name}"</Text>? y/Enter: confirm | n/Esc: cancel
        </Text>
        {profiles
          .filter((p) => p.models.some((m) => m.providerId === deleteTarget?.id))
          .map((p) => (
            <Text key={p.id} color="yellow">
              Used by profile: {p.name}
            </Text>
          ))}
        {profiles.some((p) => p.models.some((m) => m.providerId === deleteTarget?.id)) && (
          <Text dimColor>Edit or remove these profiles before deleting this provider.</Text>
        )}
        <StatusLine message={deleting ? 'Deleting...' : status} />
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
          setStatus('');
          setDeleteTarget(filteredProviders[selectedIndex] ?? null);
          setMode('confirm-delete');
        }
      }}
      onBack={onBack}
      status={status}
    />
  );
}
