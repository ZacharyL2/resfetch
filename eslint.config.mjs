import antfu from '@antfu/eslint-config';

export default antfu(
  {
    stylistic: true,
    typescript: true,

    overrides: {
      typescript: {
        'ts/no-explicit-any': 2,
        'unicorn/error-message': 0,
        'node/prefer-global/process': 0,
      },

      javascript: {
        'no-console': 1,
        'unused-imports/no-unused-vars': 1,
        'curly': [1, 'multi-line'],
      },

      stylistic: {
        'style/semi': [2, 'always'],
        'style/brace-style': [2, '1tbs'],
        'style/operator-linebreak': 0,
        'style/max-statements-per-line': 0,
      },
    },
  },

  {
    ignores: ['node_modules'],
  },
);
