/**
 * Contextual help panel for the TUI.
 *
 * Every list screen binds `?` to this overlay. The content explains the two
 * concepts that are easy to mix up — launch mode and config scope — plus the
 * screen's own keys, so the footer can stay short.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { tuiBorderStyle } from '../border-style.js';

export type HelpTopic = 'main' | 'launch' | 'providers' | 'profiles' | 'agents' | 'settings';

interface HelpContent {
  title: string;
  keys: string[];
  notes: string[];
}

const TOPICS: Record<HelpTopic, HelpContent> = {
  main: {
    title: 'AgentO — main menu',
    keys: [
      '↑↓        move the cursor',
      'Enter    open the selected section',
      '1-5      jump straight to a section',
      '?        show this help',
      'q / Esc  quit',
    ],
    notes: [
      'First run: add a provider (2), then create a profile (3), then launch (1).',
      'The menu remembers your last profile and agent, and shows them under the list.',
    ],
  },
  launch: {
    title: 'Launch Agent',
    keys: [
      '↑↓        choose a profile / agent',
      'Enter    confirm',
      'm        toggle child / independent for this launch',
      's        toggle global / project for this launch',
      'u / d    update / uninstall the selected installed agent',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'child: AgentO patches the config, runs the agent, then restores the original on exit.',
      'independent: the patched config stays; restore later with `agento restore`.',
      'global: the agent config in your home directory (all projects).',
      'project: the agent config inside the current repository (this project only).',
      'Agents that cannot run the selected profile are listed below with the reason.',
    ],
  },
  providers: {
    title: 'Providers',
    keys: [
      '↑↓        choose a provider',
      'Enter/e  edit the selected provider',
      'a        add a provider',
      'd        delete the selected provider',
      't        test the API / list models',
      'c        duplicate the selected provider',
      'i / v / a  (in models) toggle image / video / audio',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'API keys are masked in the list; the edit form shows the value being edited.',
      'A provider used by a profile cannot be deleted until the profile is changed.',
      'Models can be edited manually; Test API and Fetch models are optional helpers.',
    ],
  },
  profiles: {
    title: 'Profiles',
    keys: [
      '↑↓        choose a profile',
      'Enter    open profile details',
      'a        add a profile',
      'd        delete the selected profile',
      'e        edit the profile (in details)',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'All models in one profile must belong to the same provider.',
      'A multi-model profile needs a unique tier per model and at least one base.',
      'A profile can hold at most three models: small, base and smart.',
    ],
  },
  agents: {
    title: 'Agent Config Status',
    keys: [
      '↑↓        choose an agent / scope',
      'r        restore the original config (asks for confirmation)',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'modified means AgentO has an active backup for that agent and scope.',
      'Restore replaces the current config with the original saved before the last launch.',
      'A launched agent in child mode restores its config automatically on exit.',
    ],
  },
  settings: {
    title: 'Settings',
    keys: [
      '↑↓        choose a setting',
      'Enter/Space  switch to the next value',
      '?        show this help',
      'Esc      save and go back',
    ],
    notes: [
      'Default launch mode: child restores the config on exit; independent leaves it patched.',
      'Default config scope: global patches the home config; project patches the current repo.',
      'mergeAgentConfigs keeps unknown keys from the existing agent config when writing.',
    ],
  },
};

export interface HelpOverlayProps {
  topic: HelpTopic;
}

/** Full-screen help panel; the parent screen handles the close key. */
export function HelpOverlay({ topic }: HelpOverlayProps): React.JSX.Element {
  const content = TOPICS[topic];
  const columns = process.stdout.columns ?? 80;
  const width = Math.min(78, Math.max(50, columns - 4));

  return (
    <Box
      flexDirection="column"
      borderStyle={tuiBorderStyle()}
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text bold>{content.title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {content.keys.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {content.notes.map((line) => (
          <Text key={line} dimColor>
            {line}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>? / Esc / Enter: close</Text>
      </Box>
    </Box>
  );
}
