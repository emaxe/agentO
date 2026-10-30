/**
 * Contextual help panel for the TUI.
 *
 * Every list screen binds `?` to this overlay. The content explains the two
 * concepts that are easy to mix up — launch mode and config scope — plus the
 * screen's own keys, so the footer can stay short.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { ScrollableLines } from './ScrollableLines.js';
import { useTerminalSize } from '../use-terminal-size.js';
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
      '1-6      jump straight to a section',
      '?        show this help',
      'q / Esc  quit',
    ],
    notes: [
      'First run: Set up AgentO connects a provider, model, profile and agent in one flow.',
      'r repeats the last launch. Changed settings require a new review.',
    ],
  },
  launch: {
    title: 'Launch Agent',
    keys: [
      '↑↓        choose a profile / agent',
      'Enter    confirm',
      'm        toggle child / independent for this launch',
      's        toggle global / project for this launch',
      'v        open launch preview',
      '/        search profiles',
      'i / e    show incompatibility reasons / edit profile',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'child: AgentO patches the config, runs the agent, then restores the original on exit.',
      'independent: the patched config stays; restore later with `agento restore`.',
      'global: the agent config in your home directory (all projects).',
      'project: adapter-selected files; some agents also change global settings. Review lists all files.',
      'Use Agents & recovery to install, update, uninstall or restore an agent.',
    ],
  },
  providers: {
    title: 'Providers',
    keys: [
      '↑↓        choose a provider',
      'Enter/e  edit the selected provider',
      'a        add a provider',
      'd        delete the selected provider',
      't        load the model list (no generation test)',
      'c        duplicate the selected provider',
      'i / v / a  (in models) toggle image / video / audio',
      '?        show this help',
      'Esc      back',
    ],
    notes: [
      'API keys are masked. Ctrl+R reveals the key in the connection form.',
      'A provider used by a profile cannot be deleted until the profile is changed.',
      'Models can be edited manually; Load models and Choose loaded models are optional helpers.',
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
    title: 'Agents & recovery',
    keys: [
      '↑↓        choose an agent / scope',
      'r        restore the original config (asks for confirmation)',
      'i / u / d  install / update / uninstall the selected agent',
      'f / /    modified only / search',
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
      'Project scope may also touch global settings. Review the actual files before launch.',
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
  const { columns } = useTerminalSize();
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
      <ScrollableLines
        lines={[...content.keys, '', ...content.notes]}
        reserved={7}
        width={width - 4}
      />
      <Box marginTop={1}>
        <Text dimColor>? / Esc / Enter: close</Text>
      </Box>
    </Box>
  );
}
