// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output and dependencies are never linted.
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Every process start goes through src/platform/spawn.ts (cross-spawn + PATHEXT
    // resolution on Windows); a direct child_process call bypasses both.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: [
      'src/platform/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      // POSIX-only login-shell probe (`$SHELL -lc`); never runs on win32.
      'src/launcher/shell-path-resolver.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:child_process', 'child_process'],
              message: 'Use spawnCommand/spawnCommandSync from src/platform/spawn.ts instead.',
            },
          ],
        },
      ],
    },
  },
);
