/**
 * W6 — real-schema test project.
 *
 * Deliberately separate from the default jest project: these tests require a
 * live PostgreSQL database (W6_DB_URL) and are meaningless without one, so they
 * must never be swept up by `npm test`, which runs against mocks.
 *
 * Run via scripts/ci/real-schema-ci.sh, which provisions the database first.
 */
module.exports = {
  displayName: 'real-schema',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/backend/tests/realschema/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { module: 'commonjs', target: 'es2020', esModuleInterop: true, strict: false },
      diagnostics: false,
    }],
  },
  testTimeout: 60000,
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/backend/tests/realschema/setup.ts'],
};
