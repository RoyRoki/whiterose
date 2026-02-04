import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Bug, BugSeverity, BugCategory } from '../../types.js';

interface DashboardProps {
  bugs: Bug[];
  onSelectCategory: (category: string | null) => void;
}

interface MenuItem {
  key: string;
  label: string;
  count: number;
  color: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ bugs, onSelectCategory }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const verifiedBugs = bugs.filter((b) => b.kind === 'bug');
  const smells = bugs.filter((b) => b.kind === 'smell');

  // Calculate summary
  const summary = {
    critical: verifiedBugs.filter((b) => b.severity === 'critical').length,
    high: verifiedBugs.filter((b) => b.severity === 'high').length,
    medium: verifiedBugs.filter((b) => b.severity === 'medium').length,
    low: verifiedBugs.filter((b) => b.severity === 'low').length,
  };

  // Calculate by category
  const byCategory: Record<string, number> = {};
  for (const bug of verifiedBugs) {
    byCategory[bug.category] = (byCategory[bug.category] || 0) + 1;
  }

  // Build menu items
  const menuItems: MenuItem[] = [
    { key: 'all', label: 'All Findings', count: bugs.length, color: 'white' },
    { key: 'kind:bug', label: 'Verified Bugs', count: verifiedBugs.length, color: 'white' },
    { key: 'kind:smell', label: 'Smells', count: smells.length, color: 'gray' },
    { key: 'critical', label: 'Critical', count: summary.critical, color: 'red' },
    { key: 'high', label: 'High', count: summary.high, color: 'yellow' },
    { key: 'medium', label: 'Medium', count: summary.medium, color: 'blue' },
    { key: 'low', label: 'Low', count: summary.low, color: 'gray' },
  ];

  // Add category items
  const categoryColors: Record<string, string> = {
    'logic-error': 'magenta',
    security: 'red',
    'async-race-condition': 'cyan',
    'edge-case': 'yellow',
    'null-reference': 'blue',
    'type-coercion': 'green',
    'resource-leak': 'yellow',
    'intent-violation': 'magenta',
  };

  for (const [category, count] of Object.entries(byCategory)) {
    menuItems.push({
      key: category,
      label: formatCategory(category),
      count,
      color: categoryColors[category] || 'white',
    });
  }

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(menuItems.length - 1, i + 1));
    } else if (key.return) {
      const item = menuItems[selectedIndex];
      if (item.key === 'all') {
        onSelectCategory(null);
      } else {
        onSelectCategory(item.key);
      }
    }
  });

  if (bugs.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green" bold>
          ✓ No findings found!
        </Text>
        <Text color="gray">Your codebase looks clean.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Summary */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold underline>
          Summary
        </Text>
        <Box marginTop={1}>
          <Box marginRight={3}>
            <Text color="red">● Critical: {summary.critical}</Text>
          </Box>
          <Box marginRight={3}>
            <Text color="yellow">● High: {summary.high}</Text>
          </Box>
          <Box marginRight={3}>
            <Text color="blue">● Medium: {summary.medium}</Text>
          </Box>
          <Box>
            <Text color="gray">● Low: {summary.low}</Text>
          </Box>
        </Box>
      </Box>

      {/* Menu */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          Filter by
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {menuItems.map((item, index) => (
            <Box key={item.key}>
              <Text color={index === selectedIndex ? 'cyan' : 'white'}>
                {index === selectedIndex ? '▶ ' : '  '}
              </Text>
              <Text color={item.color}>
                {item.label}
              </Text>
              <Text color="gray"> ({item.count})</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Instructions */}
      <Box marginTop={2}>
        <Text color="gray">[↑↓] Navigate  [Enter] Select  [q] Quit</Text>
      </Box>
    </Box>
  );
};

function formatCategory(category: string): string {
  return category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
