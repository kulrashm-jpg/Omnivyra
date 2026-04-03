/**
 * Jest Configuration for P0 Implementation Tests
 * 
 * Supports TypeScript tests in backend/ directory
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // File patterns to test (exclude setupEnv.ts and other non-test files)
  testMatch: [
    '**/*.test.ts'
  ],
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  
  // Transform TypeScript files
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  
  // TypeScript configuration
  preset: 'ts-jest',
  
  // Root directories
  roots: ['<rootDir>/backend'],
  
  // Module path mapping (if needed)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
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

