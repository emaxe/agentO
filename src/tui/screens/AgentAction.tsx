import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { getAgent } from '../../agents/registry.js';
import type { AgentId } from '../../config/schema.js';
import type { InstallResult } from '../../installers/base.js';

type SubScreen = 'confirm' | 'running' | 'success' | 'error';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface AgentActionProps {
  agentId: AgentId;
  mode: 'update' | 'uninstall';
  onBack: () => void;
  onDone: (result: InstallResult) => void;
}

export function AgentAction({ agentId, mode, onBack, onDone }: AgentActionProps): React.JSX.Element {
  const [subScreen, setSubScreen] = useState<SubScreen>('confirm');
  const [selectedChoice, setSelectedChoice] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [actionError, setActionError] = useState('');

  const agent = getAgent(agentId, { dev: true });
  const agentLabel = agent?.label ?? agentId;
  const installer = agent?.installer;

  const actionVerb = mode === 'update' ? 'Обновить' : 'Удалить';
  const runningText = mode === 'update' ? 'Обновление...' : 'Удаление...';
  const successText = mode === 'update' ? 'Успешно обновлено' : 'Успешно удалено';

  useEffect(() => {
    if (subScreen === 'running') {
      const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
      return () => clearInterval(id);
    }
  }, [subScreen]);

  const runAction = (): void => {
    if (!installer) {
      setActionError('Установщик не найден');
      setSubScreen('error');
      return;
    }

    setSubScreen('running');
    const promise = mode === 'update' ? installer.update!() : installer.uninstall!();
    promise.then((result) => {
      if (result.success) {
        setSubScreen('success');
      } else {
        setActionError(result.error ?? 'Неизвестная ошибка');
        setSubScreen('error');
      }
    }).catch((err: unknown) => {
      setActionError(String(err));
      setSubScreen('error');
    });
  };

  useKeyInput((_input, key) => {
    if (subScreen === 'running') return;

    if (key.escape) {
      onBack();
      return;
    }

    if (subScreen === 'confirm') {
      if (key.upArrow) setSelectedChoice((s) => Math.max(0, s - 1));
      if (key.downArrow) setSelectedChoice((s) => Math.min(1, s + 1));
      if (key.return) {
        if (selectedChoice === 0) {
          runAction();
        } else {
          onBack();
        }
      }
    }

    if (subScreen === 'success' && key.return) {
      onDone({ success: true });
    }

    if (subScreen === 'error') {
      if (key.upArrow) setSelectedChoice((s) => Math.max(0, s - 1));
      if (key.downArrow) setSelectedChoice((s) => Math.min(1, s + 1));
      if (key.return) {
        if (selectedChoice === 0) {
          setSelectedChoice(0);
          runAction();
        } else {
          onDone({ success: false, error: actionError });
        }
      }
    }
  });

  const spinner = SPINNER_FRAMES[spinnerFrame];

  if (subScreen === 'confirm') {
    const choices = ['Да', 'Нет'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{actionVerb} {agentLabel}?</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}{c}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate, Enter select, Esc cancel</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'running') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>{actionVerb} {agentLabel}</Text>
        <Text>{spinner} {runningText}</Text>
      </Box>
    );
  }

  if (subScreen === 'success') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">✓ {agentLabel} {successText}</Text>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Продолжить</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'error') {
    const choices = ['Повторить', 'Назад'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Ошибка</Text>
        <Text dimColor>{actionError}</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}{c}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  return <Box />;
}
