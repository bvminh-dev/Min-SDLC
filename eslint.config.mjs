import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const UNSAFE_SQL = {
  // Chặn cả prisma.$queryRawUnsafe, prisma['$queryRawUnsafe'] và tách thuộc tính `const { $queryRawUnsafe } = prisma`.
  selector: ":matches(MemberExpression[property.name=/^\\$(query|execute)RawUnsafe$/], MemberExpression[property.value=/^\\$(query|execute)RawUnsafe$/], Property[key.name=/^\\$(query|execute)RawUnsafe$/])",
  message: 'Cấm $queryRawUnsafe và $executeRawUnsafe (SB-11): dùng $queryRaw/$executeRaw dạng tagged template tham số hóa.',
};
const PROCESS_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'Không đọc process.env ngoài module cấu hình (PRJ-REQ-20261006-095422735 BR6): dùng ConfigService.',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', '**/next-env.d.ts',
      'spec/**', '.claude/**', 'apps/api/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', UNSAFE_SQL, PROCESS_ENV],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // module cấu hình (API) và lib/config.ts (web: biến NEXT_PUBLIC_* được Next nhúng lúc build), test, script công cụ được đọc process.env; cấm $queryRawUnsafe vẫn áp dụng
    files: ['apps/api/src/modules/platform/config/**', 'apps/web/lib/config.ts', 'apps/api/test/**', 'scripts/**', 'apps/*/scripts/**', '*.config.mjs'],
    rules: { 'no-restricted-syntax': ['error', UNSAFE_SQL] },
  },
  {
    files: ['scripts/**', 'apps/*/scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
