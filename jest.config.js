/**
 * Jest Configuration for P0 Implementation Tests
 * 
 * Supports TypeScript tests in backend/ directory
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // File patterns to test (exclude setupEnv.ts and other non-test files)
  // Round-7 Phase 1: .tsx accepted for opt-in DOM rendering tests that use
  // the `@jest-environment jsdom` pragma — the default env stays `node`.
  testMatch: [
    '**/*.test.ts',
    '**/*.test.tsx',
  ],

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

  // Transform TypeScript files (.ts + .tsx)
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  
  // TypeScript configuration
  preset: 'ts-jest',
  
  // Root directories
  roots: ['<rootDir>/backend'],
  
  // Module path mapping (if needed)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // HARDEN-003: isomorphic-dompurify's bundled jsdom pulls ESM-only deps
    // (@exodus/bytes) that jest's CJS resolver can't load. Under tests we map
    // it to plain dompurify — identical sanitize API; tests that use it run
    // with the `@jest-environment jsdom` pragma so a window exists.
    '^isomorphic-dompurify$': 'dompurify',
  },
  
  // Coverage settings
  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.d.ts',
    '!backend/tests/**',
    '!backend/**/*.test.ts',
  ],
  
  // Setup files
  setupFiles: ['<rootDir>/jest.env.js', '<rootDir>/backend/tests/setupEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/backend/tests/globalTeardown.ts'],
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Test timeout (30 seconds for integration tests)
  testTimeout: 30000,
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
  ],
};

