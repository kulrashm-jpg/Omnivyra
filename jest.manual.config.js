/**
 * Manual / live test project — backend/tests/manual/** ONLY.
 *
 * These suites call paid providers (SerpAPI) and INSERT rows into `reports`, so
 * the default project (jest.config.js) ignores them and `npm test` can never
 * select them. This is the one deliberate way to run them:
 *
 *   npm run test:manual -- backend/tests/manual/liveSerpValidation.test.ts
 *
 * It extends the default project rather than copying it, so the transform,
 * module mapping and setupEnv.ts (which refuses production connection strings)
 * stay identical. The operator supplies any provider credentials; nothing here
 * provides them.
 */
const base = require('./jest.config');

const MANUAL_IGNORE = '/backend/tests/manual/';

module.exports = {
  ...base,
  displayName: 'manual',
  testMatch: ['<rootDir>/backend/tests/manual/**/*.test.ts'],
  testPathIgnorePatterns: base.testPathIgnorePatterns.filter((p) => p !== MANUAL_IGNORE),
};
