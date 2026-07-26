import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/worker-configuration.d.ts',
      'packages/core/test/fixtures/**',
      // tsconfig の include 外にあるため型情報付き lint の対象にできない
      'eslint.config.js',
      'scripts/**',
      '**/astro.config.mjs',
      // .astro は eslint-plugin-astro を入れるまで対象外（DESIGN.md §17.2）
      '**/*.astro',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // 設計上の不変条件（DESIGN.md §17.5）
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/status/jst.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['getHours', 'getMinutes', 'getDate', 'getDay', 'getMonth', 'getFullYear'].map((p) => ({
          property: p,
          message:
            'ローカル時刻依存。packages/core/src/status/jst.ts を使うこと（DESIGN.md §10.1）',
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[computed=true][property.value=0][object.property.name="sessions"]',
          message: '1日に複数セッションがあるのが常態。sessions[0] だけを扱う実装は禁止（§13.5）',
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
          message: 'Intl.DateTimeFormat に timeZone: "Asia/Tokyo" を明示すること（§10.1）',
        },
      ],
    },
  },

  // packages/core と packages/parser は Web 標準 API のみ（DESIGN.md §5.3）
  {
    files: ['packages/core/src/**', 'packages/parser/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'stream', 'buffer', 'crypto'],
              message: 'プラットフォーム非依存を保つため node 組込みモジュールは使用禁止（§5.3）',
            },
          ],
        },
      ],
    },
  },

  // Service Worker は tsconfig の外（public 配下）にあるので型情報なしで lint する
  {
    files: ['apps/web/public/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { self: 'readonly' },
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  prettier,
);
