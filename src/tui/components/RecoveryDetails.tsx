import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { readBackup, type BackupManifest } from '../../config/store.js';
import { isProcessAlive } from '../../launcher/transaction.js';

/** Read manifest metadata only; never render saved configuration contents. */
export function RecoveryDetails({
  agentId,
  scope,
  cwd,
}: {
  agentId: string;
  scope: 'global' | 'project';
  cwd?: string;
}) {
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    readBackup(agentId, scope, cwd ?? process.cwd())
      .then((value) => {
        if (!cancelled) setManifest(value);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, scope, cwd]);
  if (error) return <Text color="red">Error reading backup: {error}</Text>;
  if (!manifest) return <Text dimColor>Reading backup metadata...</Text>;
  return (
    <>
      <Text>
        Session:{' '}
        {manifest.pid
          ? `PID ${manifest.pid} (${isProcessAlive(manifest.pid) ? 'running; stop the agent before restoring' : 'no longer running'})`
          : 'owner status unknown'}
      </Text>
      {manifest.files.map((file, i) => (
        <Text key={i}>
          {file.hadFile ? 'Restore' : 'Remove'}: {file.path || 'agent config'}
        </Text>
      ))}
    </>
  );
}
