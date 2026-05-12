import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeyInput } from '../use-key-input.js';
import { getInstaller } from '../../installers/registry.js';
import type { AgentId } from '../../config/schema.js';

type SubScreen =
  | 'choice'
  | 'auto-checking'
  | 'installing'
  | 'success'
  | 'error-env'
  | 'error-install'
  | 'manual';

const AGENT_LABELS: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  qwen: 'Qwen CLI',
  codex: 'Codex CLI',
  copilot: 'Copilot CLI',
};

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

  const agentLabel = AGENT_LABELS[agentId];
  const installer = getInstaller(agentId);

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
      setInstallError('Установщик не найден');
      setSubScreen('error-install');
      return;
    }

    setSubScreen('auto-checking');
    installer.checkEnvironment().then((envResult) => {
      if (!envResult.ok) {
        setMissingDeps(envResult.missing);
        setSubScreen('error-env');
        return;
      }

      setSubScreen('installing');
      installer.install().then((result) => {
        if (result.success) {
          setSubScreen('success');
        } else {
          setInstallError(result.error ?? 'Неизвестная ошибка');
          setSubScreen('error-install');
        }
      }).catch((err: unknown) => {
        setInstallError(String(err));
        setSubScreen('error-install');
      });
    }).catch((err: unknown) => {
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
    const choices = ['Авто-установка', 'Ручная установка'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Установка: {agentLabel}</Text>
        <Text>Агент не установлен.</Text>
        <Box flexDirection="column" marginTop={1}>
          {choices.map((c, i) => (
            <Text key={i} color={i === selectedChoice ? 'green' : undefined}>
              {i === selectedChoice ? '▶ ' : '  '}{c}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[Esc] Назад</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'auto-checking') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Установка: {agentLabel}</Text>
        <Text>{spinner} Проверка среды...</Text>
      </Box>
    );
  }

  if (subScreen === 'installing') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Установка: {agentLabel}</Text>
        <Text>{spinner} Устанавливается...</Text>
      </Box>
    );
  }

  if (subScreen === 'success') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">✓ {agentLabel} успешно установлен!</Text>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Продолжить</Text>
        </Box>
      </Box>
    );
  }

  if (subScreen === 'error-env') {
    const missing = missingDeps.join(', ');
    const choices = ['Ручная установка', 'Назад'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Не найдено: {missing}</Text>
        <Text>Для авто-установки требуется {missing}.</Text>
        <Text>Используй ручную установку.</Text>
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

  if (subScreen === 'error-install') {
    const choices = ['Повторить', 'Ручная установка'];
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Ошибка установки</Text>
        <Text dimColor>{installError}</Text>
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

  if (subScreen === 'manual') {
    const instructions = installer?.manualInstructions;
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Ручная установка: {agentLabel}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Выполни команды:</Text>
          <Box marginTop={1} flexDirection="column">
            {instructions?.commands.map((cmd, i) => (
              <Text key={i} color="cyan">  {cmd}</Text>
            ))}
          </Box>
        </Box>
        {instructions?.docsUrl && (
          <Box marginTop={1} flexDirection="column">
            <Text>Документация:</Text>
            <Text color="blue">  {instructions.docsUrl}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[Esc] Назад</Text>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
