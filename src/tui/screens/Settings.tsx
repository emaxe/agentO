import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { useHelp } from '../use-help.js';
import { HelpOverlay } from '../components/HelpOverlay.js';
import { StatusLine } from '../components/StatusLine.js';
import { readConfig, writeConfig } from '../../config/store.js';

interface SettingDef {
  key: 'defaultLaunchMode' | 'defaultConfigScope' | 'mergeAgentConfigs';
  label: string;
  options: string[];
  descriptions: Record<string, string>;
}

/**
 * Descriptions talk about the agent's own config file (what the setting
 * actually controls), not about Agento internals.
 */
const SETTINGS: SettingDef[] = [
  {
    key: 'defaultLaunchMode',
    label: 'Default Launch Mode',
    options: ['child', 'independent'],
    descriptions: {
      child: 'Agent runs inside Agento; its config is restored automatically when it exits.',
      independent:
        "Agent runs with the patched config and it stays patched — restore later with 'agento restore'.",
    },
  },
  {
    key: 'defaultConfigScope',
    label: 'Default Config Scope',
    options: ['global', 'project'],
    descriptions: {
      global:
        "Patches the agent's global config (e.g. ~/.claude/settings.json) — applies to every project.",
      project:
        "Patches the agent's config in the current directory (e.g. ./.claude/settings.json) — may also update global settings. Review lists the actual files.",
    },
  },
  {
    key: 'mergeAgentConfigs',
    label: 'Merge Agent Configs',
    options: ['true', 'false'],
    descriptions: {
      true: "Keep unknown keys from the agent's existing config when writing (recommended).",
      false: "Replace the agent's config entirely with the generated one.",
    },
  },
];

type SettingValues = Record<SettingDef['key'], string>;

const DEFAULT_VALUES: SettingValues = {
  defaultLaunchMode: 'child',
  defaultConfigScope: 'project',
  mergeAgentConfigs: 'true',
};

interface SettingsProps {
  onBack: () => void;
}

/** Renders the settings screen with toggles for launch mode, config scope, and config merging. */
export function Settings({ onBack }: SettingsProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [values, setValues] = useState<SettingValues>(DEFAULT_VALUES);
  const [status, setStatus] = useState('');
  const saving = useRef(false);
  const help = useHelp();

  const load = useCallback(() => {
    readConfig()
      .then((config) => {
        setValues({
          defaultLaunchMode: config.settings.defaultLaunchMode,
          defaultConfigScope: config.settings.defaultConfigScope,
          mergeAgentConfigs: String(config.settings.mergeAgentConfigs),
        });
      })
      .catch((err) => setStatus(`Error: ${String(err)}`));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useKeyInput((input, key) => {
    if (saving.current) return;
    if (help.handleKey(input, key)) return;
    if (key.escape || input === 'q') {
      onBack();
      return;
    }
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelectedIndex((i) => Math.min(SETTINGS.length - 1, i + 1));
    else if (key.return || input === ' ') {
      const setting = SETTINGS[selectedIndex];
      if (!setting) return;
      const current = values[setting.key];
      const currentIdx = setting.options.indexOf(current);
      const nextOption = setting.options[(currentIdx + 1) % setting.options.length] as string;
      const newValues = { ...values, [setting.key]: nextOption };
      saving.current = true;
      setStatus('Saving...');
      readConfig()
        .then((config) =>
          writeConfig({
            ...config,
            settings: {
              ...config.settings,
              defaultLaunchMode:
                newValues.defaultLaunchMode as typeof config.settings.defaultLaunchMode,
              defaultConfigScope:
                newValues.defaultConfigScope as typeof config.settings.defaultConfigScope,
              mergeAgentConfigs: newValues.mergeAgentConfigs === 'true',
            },
          }),
        )
        .then(() => {
          setValues(newValues);
          setStatus('Saved');
        })
        .catch((err) => setStatus(`Error: ${String(err)}`))
        .finally(() => {
          saving.current = false;
        });
    }
  });

  if (help.open) {
    return <HelpOverlay topic="settings" />;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Settings</Text>
      <Text dimColor>↑↓ navigate | Enter/Space: toggle | ? help | Esc: back</Text>
      <StatusLine message={status} />
      <Box flexDirection="column" marginTop={1}>
        {SETTINGS.map((s, i) => (
          <Box key={s.key} flexDirection="column">
            <Text color={i === selectedIndex ? 'green' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}
              {s.label}: <Text bold>{values[s.key]}</Text>
            </Text>
            {i === selectedIndex && (
              <Text dimColor>
                {'    '}
                {s.descriptions[values[s.key] as keyof typeof s.descriptions]}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
