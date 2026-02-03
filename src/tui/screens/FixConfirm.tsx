import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Bug } from '../../types.js';

interface FixConfirmProps {
  bug: Bug;
  dryRun: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export const FixConfirm: React.FC<FixConfirmProps> = ({ bug, dryRun, onConfirm, onCancel }) => {
  const [status, setStatus] = useState<'confirm' | 'fixing' | 'done' | 'error'>('confirm');
  const [error, setError] = useState<string | null>(null);

  useInput(async (input, key) => {
    if (status !== 'confirm') return;

    if (input === 'y' || key.return) {
      setStatus('fixing');
      try {
        await onConfirm();
        setStatus('done');
        // Auto-close after success
        setTimeout(() => {
          onCancel();
        }, 1500);
      } catch (e: any) {
        setError(e.message || 'Unknown error');
        setStatus('error');
      }
    } else if (input === 'n' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      {/* Bug summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>Fix: </Text>
          <Text>{bug.title}</Text>
        </Box>
        <Box>
          <Text color="gray">File: </Text>
          <Text color="cyan">{bug.file}:{bug.line}</Text>
        </Box>
      </Box>

      {/* Proposed fix */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        padding={1}
        marginBottom={1}
      >
        <Text bold>Proposed Fix:</Text>
        {bug.suggestedFix ? (
          <Box marginTop={1}>
            <Text color="green">{bug.suggestedFix}</Text>
          </Box>
        ) : (
          <Text color="yellow">
            No suggested fix available. Will ask AI to generate and apply a fix.
          </Text>
        )}
      </Box>

      {/* Status */}
      {status === 'confirm' && (
        <Box flexDirection="column">
          {dryRun && (
            <Box marginBottom={1}>
              <Text color="yellow">DRY RUN MODE - Changes will NOT be applied</Text>
            </Box>
          )}
          <Box>
            <Text>Apply this fix? </Text>
            <Text color="green">[y]es</Text>
            <Text> / </Text>
            <Text color="red">[n]o</Text>
          </Box>
        </Box>
      )}

      {status === 'fixing' && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Applying fix...</Text>
        </Box>
      )}

      {status === 'done' && (
        <Box>
          <Text color="green">✓ Fix applied successfully!</Text>
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column">
          <Text color="red">✗ Failed to apply fix</Text>
          {error && <Text color="gray">{error}</Text>}
          <Box marginTop={1}>
            <Text color="gray">Press any key to go back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
