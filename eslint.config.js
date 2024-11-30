import eslint from '@eslint/js';
import ts_eslint from 'typescript-eslint';
import airbnb from 'eslint-config-airbnb';
import prettier from 'eslint-config-prettier';

export default [
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  eslint.configs.recommended,
  ts_eslint.configs.recommended,
  airbnb,
  prettier,
];
