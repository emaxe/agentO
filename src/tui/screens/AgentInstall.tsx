import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { getAgent } from '../../agents/registry.js';
import type { AgentId } from '../../config/schema.js';

type SubScreen =
  'choice' | 'auto-checking' | 'installing' | 'success' | 'error-env' | 'error-install' | 'manual';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface AgentInstallProps {
  agentId: AgentId;
  onBack: () => void;
  onDone: () => void;
}

export function AgentInstall({ agentId, onBack, onDone }: AgentInstallProps): React.JSX.Element {
  const [subScreen, setSubScreen] = useState<SubScreen>('choice');
  const [selectedChoice, setSelectedChoice] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [missingDeps, setMissingDeps] = useState<string[]>([]);
  const [installError, setInstallError] = useState('');

  const agent = getAgent(agentId, { dev: true });
  const agentLabel = agent?.label ?? agentId;
  const installer = agent?.installer;

  useEffect(() => {
    if (subScreen === 'auto-checking' || subScreen === 'installing') {
      const id = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      }, 80);
      return () => clearInterval(id);
    }
  }, [subScreen]);

  const runAutoInstall = (): void => {
    if (!installer) {
      setInstallError('Installer not found');
      setSubScreen('error-install');
      return;
    }

    setSubScreen('auto-checking');
    installer
      .checkEnvironment()
      .then((envResult) => {
        if (!envResult.ok) {
          setMissingDeps(envResult.missing);
          setSubScreen('error-env');
          return;
        }

        setSubScreen('installing');
        installer
          .install()
          .then((result) => {
            if (result.success) {
              setSubScreen('success');
            } else {
              setInstallError(result.error ?? 'Unknown error');
              setSubScreen('error-install');
            }
          })
          .catch((err: unknown) => {
            setInstallError(String(err));
            setSubScreen('error-install');
          });
      })
      .catch((err: unknown) => {
        setInstallError(String(err));
        setSubScreen('error-install');
      });
  };

  useKeyInput((_input, key) => {
    if (subScreen === 'auto-checking' || subScreen === 'installing') return;

    if (key.escape) {
      if (subScreen === 'choice') {
        onBack();
      } else {
        setSubScreen('choice');
        setSelectedChoice(0);
      }
      return;
    }

    if (subScreen === 'choice') {
      if (key.upArrow) setSelectedChoice((s) => Math.max(0, s - 1));
      if (key.downArrow) setSelectedChoice((s) => Math.min(1, s + 1));
      if (key.return) {
        if (selectedChoice === 0) {
          runAutoInstall();
        } else {
          setSubScreen('manual');
        }
      }
    }

    if (subScreen === 'success' && key.return) {
      onDone();
    }

    if (subScreen === 'error-env') {
      if (key.upArrow) setSelectedChoice((s) => Math.max(0, s - 1));
      if (key.downArrow) setSelectedChoice((s) => Math.min(1, s + 1));
      if (key.return) {
        if (selectedChoice === 0) {
          setSubScreen('manual');
          setSelectedChoice(0);
        } else {
          setSubScreen('choice');
          setSelectedChoice(0);
        }
      }
    }

    if (subScreen === 'error-install') {
      if (key.upArrow) setSelectedChoice((s) => Math.max(0, s - 1));
      if (key.downArrow) setSelectedChoice((s) => Math.min(1, s + 1));
      if (key.return) {
        if (selectedChoice === 0) {
          setSelectedChoice(0);
          runAutoInstall();
        } else {
          setSubScreen('manual');
          setSelectedChoice(0);
        }
      }
    }

    if (subScreen === 'manual' && key.escape) {
      setSubScreen('choice');
      setSelectedChoice(0);
    }
  });

  const spinner = SPINNER_FRAMES[spinnerFrame];

  if (subScreen === 'choice') {
    const choices = ['Auto-install', 'Manual install'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Install: {agentLabel}</Text>
        <Text>Agent is not installed.</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}
              {c}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'auto-checking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Install: {agentLabel}</Text>
        <Text>{spinner} Checking environment...</Text>
      </Box>
    );
  }

  if (subScreen === 'installing') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Install: {agentLabel}</Text>
        <Text>{spinner} Installing...</Text>
      </Box>
    );
  }

  if (subScreen === 'success') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">✓ {agentLabel} installed successfully!</Text>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Continue</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'error-env') {
    const missing = missingDeps.join(', ');
    const choices = ['Manual install', 'Back'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Missing: {missing}</Text>
        <Text>Auto-install requires {missing}.</Text>
        <Text>Use manual install instead.</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}
              {c}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (subScreen === 'error-install') {
    const choices = ['Retry', 'Manual install'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Install failed</Text>
        <Text dimColor>{installError}</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}
              {c}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (subScreen === 'manual') {
    const instructions = installer?.manualInstructions;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Manual install: {agentLabel}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Run these commands:</Text>
          <Box marginTop={1} flexDirection="column">
            {instructions?.commands.map((cmd, i) => (
              <Text key={i} color="cyan">
                {' '}
                {cmd}
              </Text>
            ))}
          </Box>
        </Box>
        {instructions?.docsUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text>Documentation:</Text>
            <Text color="blue"> {instructions.docsUrl}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
