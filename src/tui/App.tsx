import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Bug, WhiteroseConfig } from '../types.js';
import { Dashboard } from './screens/Dashboard.js';
import { BugList } from './screens/BugList.js';
import { BugDetail } from './screens/BugDetail.js';
import { FixConfirm } from './screens/FixConfirm.js';

export type Screen = 'dashboard' | 'list' | 'detail' | 'fix';

export interface AppState {
  screen: Screen;
  bugs: Bug[];
  selectedCategory: string | null;
  selectedBugIndex: number;
  config: WhiteroseConfig;
  fixOptions: {
    dryRun: boolean;
    branch?: string;
  };
}

interface AppProps {
  bugs: Bug[];
  config: WhiteroseConfig;
  fixOptions: {
    dryRun: boolean;
    branch?: string;
  };
  onFix: (bug: Bug) => Promise<void>;
  onExit: () => void;
}

export const App: React.FC<AppProps> = ({ bugs, config, fixOptions, onFix, onExit }) => {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    screen: 'dashboard',
    bugs,
    selectedCategory: null,
    selectedBugIndex: 0,
    config,
    fixOptions,
  });

  // Filter bugs based on selected category
  const filteredBugs = state.selectedCategory
    ? state.bugs.filter((b) => b.category === state.selectedCategory || b.severity === state.selectedCategory)
    : state.bugs;

  const selectedBug = filteredBugs[state.selectedBugIndex];

  // Handle global keys
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      onExit();
      exit();
      return;
    }

    if (key.escape) {
      // Go back
      if (state.screen === 'fix') {
        setState((s) => ({ ...s, screen: 'detail' }));
      } else if (state.screen === 'detail') {
        setState((s) => ({ ...s, screen: 'list' }));
      } else if (state.screen === 'list') {
        setState((s) => ({ ...s, screen: 'dashboard', selectedCategory: null }));
      }
    }
  });

  const handleSelectCategory = (category: string | null) => {
    setState((s) => ({
      ...s,
      screen: 'list',
      selectedCategory: category,
      selectedBugIndex: 0,
    }));
  };

  const handleSelectBug = (index: number) => {
    setState((s) => ({
      ...s,
      screen: 'detail',
      selectedBugIndex: index,
    }));
  };

  const handleStartFix = () => {
    setState((s) => ({ ...s, screen: 'fix' }));
  };

  const handleConfirmFix = async () => {
    if (selectedBug) {
      await onFix(selectedBug);
      // Move to next bug or back to list
      if (state.selectedBugIndex < filteredBugs.length - 1) {
        setState((s) => ({
          ...s,
          screen: 'detail',
          selectedBugIndex: s.selectedBugIndex + 1,
        }));
      } else {
        setState((s) => ({ ...s, screen: 'list' }));
      }
    }
  };

  const handleCancelFix = () => {
    setState((s) => ({ ...s, screen: 'detail' }));
  };

  const handleBack = () => {
    if (state.screen === 'fix') {
      setState((s) => ({ ...s, screen: 'detail' }));
    } else if (state.screen === 'detail') {
      setState((s) => ({ ...s, screen: 'list' }));
    } else if (state.screen === 'list') {
      setState((s) => ({ ...s, screen: 'dashboard', selectedCategory: null }));
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="red" bold>
          whiterose
        </Text>
        <Text color="gray"> - fix mode</Text>
        <Text color="gray"> | </Text>
        <Text color="gray">
          {state.screen === 'dashboard' && 'Dashboard'}
          {state.screen === 'list' && `Bugs${state.selectedCategory ? ` (${state.selectedCategory})` : ''}`}
          {state.screen === 'detail' && `Bug ${state.selectedBugIndex + 1}/${filteredBugs.length}`}
          {state.screen === 'fix' && 'Confirm Fix'}
        </Text>
      </Box>

      {/* Main content */}
      {state.screen === 'dashboard' && (
        <Dashboard bugs={state.bugs} onSelectCategory={handleSelectCategory} />
      )}

      {state.screen === 'list' && (
        <BugList
          bugs={filteredBugs}
          selectedIndex={state.selectedBugIndex}
          onSelect={handleSelectBug}
          onBack={handleBack}
        />
      )}

      {state.screen === 'detail' && selectedBug && (
        <BugDetail
          bug={selectedBug}
          index={state.selectedBugIndex}
          total={filteredBugs.length}
          onFix={handleStartFix}
          onNext={() =>
            setState((s) => ({
              ...s,
              selectedBugIndex: Math.min(s.selectedBugIndex + 1, filteredBugs.length - 1),
            }))
          }
          onPrev={() =>
            setState((s) => ({
              ...s,
              selectedBugIndex: Math.max(s.selectedBugIndex - 1, 0),
            }))
          }
          onBack={handleBack}
        />
      )}

      {state.screen === 'fix' && selectedBug && (
        <FixConfirm
          bug={selectedBug}
          dryRun={fixOptions.dryRun}
          onConfirm={handleConfirmFix}
          onCancel={handleCancelFix}
        />
      )}

      {/* Footer */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          [q] Quit  [esc] Back  [↑↓] Navigate  [enter] Select  [f] Fix
        </Text>
      </Box>
    </Box>
  );
};
