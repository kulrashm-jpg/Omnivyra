/**
 * CREATOR-090 — local sample-generation bootstrap.
 *
 * Injects MINIMAL LOCAL dummy env values BEFORE the backend's env validation so the
 * internal generation function can be invoked locally. It NEVER loads .env.local,
 * NEVER connects to production, NEVER uses real credentials, and NEVER spends
 * credits (the dummy values point at localhost / are non-functional). Production
 * runtime is unaffected — these assignments are process-local to this one script.
 *
 *   DEMO_COMPANY_ID=<id> LIMIT=1 ASSET_TYPE=image npx tsx scripts/populate-sample-library.ts
 */

// Minimal local values that satisfy config/env.schema.ts validation only.
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'local-dev-service-role-key',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-dev-anon-key',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
for (const [k, v] of Object.entries(LOCAL_ENV)) if (!process.env[k]) process.env[k] = v;

const companyId = (process.env.DEMO_COMPANY_ID || 'local-dev-company').trim();
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
const assetType = (process.env.ASSET_TYPE as 'image' | 'carousel' | 'infographic' | undefined) || undefined;

void (async () => {
  console.error('[run] importing backend…');
  const { populateMarketingSamples } = await import('../backend/services/creator/populateMarketingSamples');
  console.error('[run] import complete; calling populateMarketingSamples…');
  const r = await populateMarketingSamples({ companyId, limit, assetType });
  console.error('[run] populateMarketingSamples returned.');
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.failed > 0 && r.succeeded === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });

// TYPECHECK-BASELINE-REDUCTION: this file has no top-level import or export, so
// TypeScript compiles it as a GLOBAL script and its top-level declarations share
// one scope with every other global script under tsconfig.scripts.json. That is
// the root cause of the duplicate-identifier / duplicate-implementation errors,
// and of the downstream mismatches where a colliding name resolved to another
// file's type. Declaring it a module scopes its names to this file.
// Runtime is unchanged: no static import is added and the script still executes
// top-to-bottom exactly as before.
export {};