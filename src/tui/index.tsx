import React from 'react';
import { render } from 'ink';
import { Bug, WhiteroseConfig } from '../types.js';
import { App } from './App.js';
import { applyFix } from '../core/fixer.js';

interface FixOptions {
  dryRun: boolean;
  branch?: string;
}

export async function startFixTUI(
  bugs: Bug[],
  config: WhiteroseConfig,
  options: FixOptions
): Promise<void> {
  return new Promise((resolve) => {
    const handleFix = async (bug: Bug) => {
      await applyFix(bug, config, options);
    };

    const handleExit = () => {
      resolve();
    };

    const { unmount, waitUntilExit } = render(
      <App
        bugs={bugs}
        config={config}
        fixOptions={options}
        onFix={handleFix}
        onExit={handleExit}
      />
    );

    waitUntilExit().then(() => {
      resolve();
    });
  });
}

// Also export a simpler non-interactive mode for CI/scripts
export { App } from './App.js';
export { Dashboard } from './screens/Dashboard.js';
export { BugList } from './screens/BugList.js';
export { BugDetail } from './screens/BugDetail.js';
export { FixConfirm } from './screens/FixConfirm.js';
