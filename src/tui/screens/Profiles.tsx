import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { listProfiles, addProfile, removeProfile, moveModelUp, moveModelDown } from '../../profiles/profile-manager.js';
import type { Profile } from '../../config/schema.js';

type Mode = 'list' | 'add' | 'detail' | 'confirm-delete';

interface ProfilesProps {
  onBack: () => void;
}

export function Profiles({ onBack }: ProfilesProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('list');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailModelIndex, setDetailModelIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [formName, setFormName] = useState('');
  const [formModels, setFormModels] = useState(''); // "providerId:model,..."

  const reload = useCallback(() => {
    listProfiles().then(setProfiles).catch(console.error);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
      else if (key.return && profiles[selectedIndex]) {
        setDetailProfile(profiles[selectedIndex]);
        setDetailModelIndex(0);
        setMode('detail');
      }
      else if (input === 'a') { setMode('add'); setFormName(''); setFormModels(''); }
      else if (input === 'd' && profiles[selectedIndex]) {
        setMode('confirm-delete');
      }
    } else if (mode === 'confirm-delete') {
      if (input === 'y' && profiles[selectedIndex]) {
        removeProfile(profiles[selectedIndex].id)
          .then(() => { setStatus(`Deleted`); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
      } else {
        setMode('list');
      }
    } else if (mode === 'detail' && detailProfile) {
      if (key.escape || input === 'q') { setMode('list'); return; }
      if (key.upArrow) {
        moveModelUp(detailProfile.id, detailModelIndex)
          .then((updated) => { setDetailProfile(updated); reload(); setDetailModelIndex(Math.max(0, detailModelIndex - 1)); })
          .catch(console.error);
      } else if (key.downArrow) {
        moveModelDown(detailProfile.id, detailModelIndex)
          .then((updated) => { setDetailProfile(updated); reload(); setDetailModelIndex(Math.min(detailProfile.models.length - 1, detailModelIndex + 1)); })
          .catch(console.error);
      }
    } else if (mode === 'add') {
      if (key.escape) { setMode('list'); return; }
      if (key.return) {
        const models = formModels.split(',').map((pair) => {
          const [providerId, ...rest] = pair.trim().split(':');
          return { providerId: providerId ?? '', model: rest.join(':') };
        }).filter((m) => m.providerId && m.model);
        if (!formName || models.length === 0) { setStatus('Name and at least one providerId:model required'); return; }
        addProfile({ name: formName, models })
          .then((p) => { setStatus(`Added "${p.name}"`); reload(); setMode('list'); })
          .catch((err) => setStatus(`Error: ${String(err)}`));
        return;
      }
      // Simplified: input goes to formModels if formName is filled, else formName
      if (key.backspace || key.delete) {
        if (!formName) return;
        if (!formModels) setFormName((s) => s.slice(0, -1));
        else setFormModels((s) => s.slice(0, -1));
      } else if (!key.ctrl && !key.meta && input.length === 1) {
        if (!formName || (input === '\t')) setFormName((s) => s + input);
        else setFormModels((s) => s + input);
      }
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
      <Box flexDirection="column" padding={1}>
        <Text bold>Add Profile</Text>
        <Text dimColor>Type name, then models as "provId:model,provId:model", Enter to save</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Name: <Text color="green">{formName}█</Text></Text>
          <Text>Models: <Text color="green">{formModels}</Text></Text>
        </Box>
        {status && <Text color="yellow">{status}</Text>}
      </Box>
    );
  }

  if (mode === 'detail' && detailProfile) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{detailProfile.name}</Text>
        <Text dimColor>↑↓ reorder models, Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {detailProfile.models.map((m, i) => (
            <Text key={i} color={i === detailModelIndex ? 'green' : undefined}>
              {i === detailModelIndex ? '▶ ' : '  '}{m.model} (provider: {m.providerId.slice(0, 8)}...)
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Profiles</Text>
      <Text dimColor>↑↓ navigate | Enter: detail | a: add | d: delete | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {profiles.map((p, i) => (
          <Text key={p.id} color={i === selectedIndex ? 'green' : undefined}>
            {i === selectedIndex ? '▶ ' : '  '}{p.name} ({p.models.length} models)
          </Text>
        ))}
        {profiles.length === 0 && <Text dimColor>No profiles. Press 'a' to add.</Text>}
      </Box>
    </Box>
  );
}
