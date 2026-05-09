import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { readConfig, writeConfig } from '../../config/store.js';

const SETTINGS = [
  { key: 'defaultLaunchMode' as const, label: 'Default Launch Mode', options: ['child', 'independent'] },
  { key: 'defaultConfigScope' as const, label: 'Default Config Scope', options: ['global', 'project'] },
];

interface SettingsProps {
  onBack: () => void;
}

export function Settings({ onBack }: SettingsProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [values, setValues] = useState({ defaultLaunchMode: 'child', defaultConfigScope: 'global' });
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    readConfig().then((config) => {
      setValues({
        defaultLaunchMode: config.settings.defaultLaunchMode,
        defaultConfigScope: config.settings.defaultConfigScope,
      });
    }).catch(console.error);
  }, []);

  useEffect(() => { load(); }, [load]);

  useKeyInput((input, key) => {
    if (key.escape || input === 'q') { onBack(); return; }
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelectedIndex((i) => Math.min(SETTINGS.length - 1, i + 1));
    else if (key.return || input === ' ') {
      const setting = SETTINGS[selectedIndex];
      if (!setting) return;
      const current = values[setting.key];
      const currentIdx = setting.options.indexOf(current);
      const nextOption = setting.options[(currentIdx + 1) % setting.options.length] as string;
      const newValues = { ...values, [setting.key]: nextOption };
      setValues(newValues as typeof values);
      readConfig().then((config) => {
        config.settings = { ...config.settings, ...newValues } as typeof config.settings;
        return writeConfig(config);
      }).then(() => setStatus('Saved')).catch((err) => setStatus(`Error: ${String(err)}`));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Settings</Text>
      <Text dimColor>↑↓ navigate | Enter/Space: toggle | Esc: back</Text>
      {status && <Text color="green">{status}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {SETTINGS.map((s, i) => (
          <Text key={s.key} color={i === selectedIndex ? 'green' : undefined}>
            {i === selectedIndex ? '▶ ' : '  '}{s.label}: <Text bold>{values[s.key]}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
