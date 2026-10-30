import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useStableSelection } from '../use-stable-selection.js';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { ProfileList } from './ProfileList.js';
import { ProfileDetail } from './ProfileDetail.js';
import { ProfileEdit } from './ProfileEdit.js';
import { ProfileWizard } from '../wizards/ProfileWizard.js';
import {
  listProfiles,
  addProfile,
  updateProfile,
  removeProfile,
} from '../../profiles/profile-manager.js';
import { listProviders } from '../../providers/provider-manager.js';
import type { Profile, Provider } from '../../config/schema.js';

type Mode = 'list' | 'detail' | 'add' | 'edit' | 'confirm-delete';

interface ProfilesProps {
  onBack: () => void;
  onNavigateToProviders?: () => void;
}

/** Ink component for managing profiles (list, add, edit, delete). */
export function Profiles({ onBack, onNavigateToProviders }: ProfilesProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailModelIndex, setDetailModelIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [status, setStatus] = useState('');
  const [editStartAddingModel, setEditStartAddingModel] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const help = useHelp();

  const reload = useCallback(() => {
    listProfiles().then(setProfiles).catch(console.error);
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const lower = query.trim().toLowerCase();
  const filteredProfiles = lower
    ? profiles.filter((profile) => {
        const providerNames = profile.models
          .map((model) => providers.find((p) => p.id === model.providerId)?.name ?? '')
          .join(' ');
        const modelNames = profile.models.map((model) => model.model).join(' ');
        return `${profile.name} ${modelNames} ${providerNames}`.toLowerCase().includes(lower);
      })
    : profiles;

  useStableSelection(
    filteredProfiles.map((item) => item.id),
    selectedIndex,
    setSelectedIndex,
  );

  useKeyInput(
    (input, key) => {
      if ((mode === 'list' || mode === 'detail') && !searchOpen && help.handleKey(input, key)) {
        return;
      }

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
          setSelectedIndex((i) => Math.min(Math.max(0, filteredProfiles.length - 1), i + 1));
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
          setQuery((q) => q + input);
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
          setSelectedIndex((i) => Math.min(Math.max(0, filteredProfiles.length - 1), i + 1));
        } else if (key.return && filteredProfiles[selectedIndex]) {
          setDetailProfile(filteredProfiles[selectedIndex]!);
          setDetailModelIndex(0);
          setMode('detail');
        } else if (input === 'a') {
          if (providers.length === 0) {
            if (onNavigateToProviders) {
              onNavigateToProviders();
              return;
            }
            setStatus('Add at least one provider first');
            return;
          }
          setStatus('');
          setMode('add');
        } else if (input === 'p' && providers.length === 0) {
          if (onNavigateToProviders) {
            onNavigateToProviders();
            return;
          }
          setStatus('Add at least one provider first');
          return;
        } else if (input === 'd' && filteredProfiles[selectedIndex]) {
          setDeleteTarget(filteredProfiles[selectedIndex]!);
          setMode('confirm-delete');
        }
        return;
      }

      if (mode === 'confirm-delete') {
        const lowerInput = input.toLowerCase();
        if ((key.return || lowerInput === 'y') && deleteTarget) {
          removeProfile(deleteTarget.id)
            .then(() => {
              setStatus('Deleted');
              setDeleteTarget(null);
              setQuery('');
              setSearchOpen(false);
              reload();
              setMode('list');
            })
            .catch((err) => setStatus(`Error: ${String(err)}`));
        } else if (key.escape || lowerInput === 'n' || input === 'q') {
          setDeleteTarget(null);
          setMode('list');
        }
        return;
      }

      if (mode === 'detail' && detailProfile) {
        if (key.escape || input === 'q') {
          setMode('list');
          return;
        }
        if (input === 'd') {
          if (detailProfile.models.length === 0) {
            setStatus('No models to delete');
            return;
          }
          if (detailProfile.models.length === 1) {
            setStatus("Cannot remove the last model; press 'e' and edit the model list");
            return;
          }
          const newModels = detailProfile.models.filter((_, i) => i !== detailModelIndex);
          updateProfile(detailProfile.id, { models: newModels })
            .then((updated) => {
              setDetailProfile(updated);
              reload();
              setDetailModelIndex(Math.max(0, detailModelIndex - 1));
              setStatus('');
            })
            .catch((err) => setStatus(`Error: ${String(err)}`));
          return;
        }
        if (input === 'a') {
          if (detailProfile.models.length >= 3) {
            setStatus('Maximum 3 models (one per tier)');
            return;
          }
          setStatus('');
          setEditStartAddingModel(true);
          setMode('edit');
          return;
        }
        if (input === 'e') {
          setStatus('');
          setEditStartAddingModel(false);
          setMode('edit');
          return;
        }
        if (key.upArrow) {
          setDetailModelIndex(Math.max(0, detailModelIndex - 1));
        } else if (key.downArrow) {
          setDetailModelIndex(Math.min(detailProfile.models.length - 1, detailModelIndex + 1));
        }
        return;
      }
    },
    { textInput: searchOpen },
  );

  if (help.open) {
    return <HelpOverlay topic="profiles" />;
  }

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>
          Delete profile <Text bold>"{deleteTarget?.name}"</Text>? y/Enter: confirm | n/Esc: cancel
        </Text>
        <Text color="red">{status}</Text>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <ProfileWizard
        providers={providers}
        profiles={profiles}
        onDone={(result) => {
          return addProfile({ name: result.name, models: result.models })
            .then((p) => {
              setStatus(`Added "${p.name}"`);
              setQuery('');
              setSearchOpen(false);
              reload();
              setMode('list');
            })
            .catch((err) => {
              throw err;
            });
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'edit' && detailProfile) {
    return (
      <ProfileEdit
        profile={detailProfile}
        providers={providers}
        profiles={profiles}
        onSave={async (result) => {
          if (result._deleteProfile) {
            await removeProfile(detailProfile.id);
            setStatus('Profile deleted');
            reload();
            setMode('list');
            return;
          }
          const updated = await updateProfile(detailProfile.id, {
            name: result.name,
            models: result.models,
          });
          setDetailProfile(updated);
          setQuery('');
          setSearchOpen(false);
          reload();
          setMode('detail');
        }}
        onCancel={() => setMode('detail')}
        startAddingModel={editStartAddingModel}
      />
    );
  }

  if (mode === 'detail' && detailProfile) {
    return (
      <ProfileDetail
        profile={detailProfile}
        providers={providers}
        selectedModel={detailModelIndex}
        status={status}
        onBack={() => setMode('list')}
        onAddModel={() => setMode('edit')}
        onDeleteModel={() => {}}
        onEdit={() => setMode('edit')}
      />
    );
  }

  return (
    <ProfileList
      profiles={filteredProfiles}
      selected={selectedIndex}
      filter={query}
      searchOpen={searchOpen}
      onSelect={setSelectedIndex}
      onAdd={() => {
        if (providers.length === 0) {
          setStatus('Add at least one provider first');
          return;
        }
        setStatus('');
        setMode('add');
      }}
      onDelete={() => {
        if (filteredProfiles[selectedIndex]) {
          setDeleteTarget(filteredProfiles[selectedIndex]!);
          setMode('confirm-delete');
        }
      }}
      onBack={onBack}
      status={status}
    />
  );
}
