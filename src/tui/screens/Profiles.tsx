import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { ProfileList } from './ProfileList.js';
import { ProfileDetail } from './ProfileDetail.js';
import { ProfileEdit } from './ProfileEdit.js';
import { ProfileWizard } from '../wizards/ProfileWizard.js';
import { listProfiles, addProfile, updateProfile, removeProfile } from '../../profiles/profile-manager.js';
import { listProviders } from '../../providers/provider-manager.js';
import type { Profile, Provider } from '../../config/schema.js';

type Mode = 'list' | 'detail' | 'add' | 'edit' | 'confirm-delete';

interface ProfilesProps {
  onBack: () => void;
}

/** Ink component for managing profiles (list, add, edit, delete). */
export function Profiles({ onBack }: ProfilesProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailModelIndex, setDetailModelIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [editStartAddingModel, setEditStartAddingModel] = useState(false);

  const reload = useCallback(() => {
    listProfiles().then(setProfiles).catch(console.error);
    listProviders().then(setProviders).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useKeyInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
      else if (key.return && profiles[selectedIndex]) {
        setDetailProfile(profiles[selectedIndex]);
        setDetailModelIndex(0);
        setMode('detail');
      }
      else if (input === 'a') {
        if (providers.length === 0) {
          setStatus('Add at least one provider first');
          return;
        }
        setStatus('');
        setMode('add');
      }
      else if (input === 'd' && profiles[selectedIndex]) {
        setMode('confirm-delete');
      }
      return;
    }

    if (mode === 'confirm-delete') {
      if (input === 'y' && profiles[selectedIndex]) {
        removeProfile(profiles[selectedIndex].id)
          .then(() => { setStatus('Deleted'); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
      return;
    }

    if (mode === 'detail' && detailProfile) {
      if (key.escape || input === 'q') { setMode('list'); return; }
      if (input === 'd') {
        if (detailProfile.models.length <= 1) {
          setStatus('Cannot delete the last model');
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
  });

  if (mode === 'confirm-delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Delete profile <Text bold>"{profiles[selectedIndex]?.name}"</Text>? (y/n)</Text>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <ProfileWizard
        providers={providers}
        onDone={(result) => {
          addProfile({ name: result.name, models: result.models })
            .then((p) => { setStatus(`Added "${p.name}"`); reload(); setMode('list'); })
            .catch((err) => setStatus(`Error: ${String(err)}`));
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
        onSave={(result) => {
          updateProfile(detailProfile.id, { name: result.name, models: result.models })
            .then((updated) => { setDetailProfile(updated); reload(); setMode('detail'); })
            .catch((err) => setStatus(`Error: ${String(err)}`));
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
        onBack={() => setMode('list')}
        onAddModel={() => setMode('edit')}
        onDeleteModel={() => {}}
        onEdit={() => setMode('edit')}
      />
    );
  }

  return (
    <ProfileList
      profiles={profiles}
      selected={selectedIndex}
      onSelect={setSelectedIndex}
      onAdd={() => {
        if (providers.length === 0) {
          setStatus('Add at least one provider first');
          return;
        }
        setStatus('');
        setMode('add');
      }}
      onDelete={() => profiles[selectedIndex] && setMode('confirm-delete')}
      onBack={onBack}
      status={status}
    />
  );
}
