import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', '.vite/**', 'out/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
];
