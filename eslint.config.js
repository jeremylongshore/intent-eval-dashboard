// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'site/**',
      'cmd/**',
      'scripts/**',
      'data/**',
      // CI checks out the kernel sibling here (ingest-ci.yml) until core@0.2.0
      // publishes to npm; never lint the vendored kernel's own sources.
      '_kernel/**',
      '*.config.js',
      '*.config.ts',
      '*.cjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Test files: child/start stubs are written as `async` arrows for symmetry
    // with the production async ChildStart signature even when the stub body has
    // no inner await; an empty logger stub (`info: () => {}`) is a legitimate
    // test double. These ergonomics do not apply to production code.
    files: ['src/**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  prettier,
);
