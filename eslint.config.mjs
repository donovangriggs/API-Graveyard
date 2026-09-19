// Flat config. The point of a linter here is not style — the code is already
// consistent — it is the class of bug no test catches: a name that no longer
// exists, an unused import left behind by a refactor, a comparison that can
// never be true. Style rules are deliberately absent; they generate churn and
// argument without catching anything.
import js from '@eslint/js';

export default [
  { ignores: ['node_modules/', 'docs/badge/'] },

  {
    ...js.configs.recommended,
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node's globals. docs/*.mjs runs in a browser instead, and is
        // narrowed below.
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // An unused catch binding is this codebase's idiom for "the failure
      // itself is the answer", so it is not a finding.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'require-atomic-updates': 'error',
      'no-constant-binary-expression': 'error',
      'no-promise-executor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    files: ['docs/**/*.mjs'],
    languageOptions: {
      globals: {
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
];
