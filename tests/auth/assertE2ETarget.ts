/**
 * Standalone preflight: asserts the configured Supabase target is the dedicated
 * non-production E2E project. Exits non-zero with a secret-free message
 * otherwise. Run with tsx (npm run check:auth-e2e-target).
 */
import dotenv from 'dotenv';

import { assertNonProductionE2EEnvironment, loadE2EEnvFile } from './e2eEnvironmentGuard';

// Same source of truth as the harness. Never .env.local.
loadE2EEnvFile(dotenv.config);

try {
  const result = assertNonProductionE2EEnvironment({
    supabaseUrl:
      process.env.E2E_SUPABASE_URL ||
      process.env.E2E_NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey:
      process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    expectedProjectRef: process.env.AUTH_E2E_EXPECTED_PROJECT_REF ?? undefined,
  });
  console.log(`Auth E2E target validated: ${result.description}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
