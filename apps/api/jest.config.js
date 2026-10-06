/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }] },
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  testTimeout: 60_000,
  maxWorkers: 1, // chung một PostgreSQL thật, các bộ test tuần tự (BR11)
};
