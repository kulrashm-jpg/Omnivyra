/**
 * Wave 2 — "Kill the Universal Taxes": rollout wiring + parity contracts.
 *
 * Every behavioral change ships flag-gated (default OFF = legacy byte-for-
 * byte). This suite locks (a) the default-off state of all four Wave 2
 * flags, (b) the source-level parity invariants between legacy and candidate
 * paths (guard layer lists, decision-tree mirroring markers), and (c) the
 * mechanical always-on changes (single-flight, parallel batches, hoisted
 * imports). Runtime behavior of the guarded paths is covered by the
 * pre-existing tenantAuthzGuard / tenantGuardIdentity / aiRequestGuard
 * suites, which run against the DEFAULT (legacy) paths unchanged.
 */
import fs from 'fs';
import path from 'path';
import { listRolloutFlags, resolveRolloutSync } from '../../../lib/platform/rollout';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Importing the modules registers their flags (all are side-effect-light).
import '../../security/TenantGuard';
import '../../services/ai/aiRequestGuard';
import '../../../lib/security/safeFetch';
import '../../queue/bullmqClient';
import '../../services/aiGatewayCore'; // registers gateway-overhead

const tenantGuardSrc = read('backend/security/TenantGuard.ts');
const aiGuardSrc = read('backend/services/ai/aiRequestGuard.ts');
const safeFetchSrc = read('lib/security/safeFetch.ts');
const opsSrc = read('backend/services/aiGatewayProvidersOps.ts');
const coreSrc = read('backend/services/aiGatewayCore.ts');
const authResolverSrc = read('backend/services/authResolver.ts');
const identitySrc = read('backend/security/IdentityResolver.ts');
const growthSrc = read('pages/api/reports/growth.ts');

describe('Wave 2 rollout flags: registered and OFF by default', () => {
  const expectFlagOff = (key: string) => {
    const flag = listRolloutFlags().find((f) => f.key === key);
    expect(flag).toBeDefined();
    expect(resolveRolloutSync(flag!)).toEqual({ mode: 'off', source: 'default' });
  };
  test('tenant-guard-batch', () => expectFlagOff('tenant-guard-batch'));
  test('lua-ai-guard', () => expectFlagOff('lua-ai-guard'));
  test('gateway-overhead', () => expectFlagOff('gateway-overhead'));
  test('outbound-keepalive', () => expectFlagOff('outbound-keepalive'));
  test('redis-shared-connection', () => expectFlagOff('redis-shared-connection'));
});

describe('W2-1 guard consolidation (shadow-comparable)', () => {
  test('fast path: flag off routes directly to the sequential guard', () => {
    expect(tenantGuardSrc).toMatch(/if \(mode === 'off'\) return assertTenantAccessSequential\(input\);/);
  });
  test('shadow wiring: legacy authoritative, divergence observed', () => {
    expect(tenantGuardSrc).toMatch(/legacy: \(\) => assertTenantAccessSequential\(input\)/);
    expect(tenantGuardSrc).toMatch(/candidate: \(\) => assertTenantAccessBatched\(input\)/);
    expect(tenantGuardSrc).toContain('tenant_guard_shadow_divergence');
  });
  test('candidate mirrors every decision reason of the sequential path', () => {
    const reasons = ['NO_AUTH', 'NO_ORG_ID', 'NOT_A_MEMBER', 'TENANT_LOOKUP_ERROR',
      'STALE_MEMBERSHIP', 'INSUFFICIENT_ROLE', 'ORG_NOT_FOUND', 'ORG_INACTIVE'];
    const batched = tenantGuardSrc.slice(
      tenantGuardSrc.indexOf('async function assertTenantAccessBatched'),
      tenantGuardSrc.indexOf('async function assertTenantAccessSequential'),
    );
    for (const reason of reasons) expect(batched).toContain(`'${reason}'`);
    // Batched reads are request-memoized (the audit's 3×-read killer).
    expect(batched).toContain("memoRequest(`guard:superadmin:");
    expect(batched).toContain("memoRequest(`guard:membership:");
    expect(batched).toContain("memoRequest(`guard:org:");
  });
});

describe('W2-3 Lua AI guard parity', () => {
  test('layer definitions are IDENTICAL between the Lua and JS paths', () => {
    // Extract every `{ label: '...', prefix: '...'` tuple; the file contains
    // the list twice (Lua-eligible builder + legacy loop) — they must match
    // exactly, in order.
    const tuples = [...aiGuardSrc.matchAll(/label: '([a-z_]+)',\s*prefix: '([a-z:]+)'/g)]
      .map((m) => `${m[1]}=${m[2]}`);
    expect(tuples.length).toBe(14); // 7 layers × 2 paths
    expect(tuples.slice(0, 7)).toEqual(tuples.slice(7));
  });
  test('Lua path falls back to JS on any non-guard error (fail-open)', () => {
    expect(aiGuardSrc).toContain('ai_guard_lua_fallback');
    expect(aiGuardSrc).toMatch(/if \(err instanceof AiGuardError\) throw err;\s*\n\s*\/\/ Automatic fallback/);
  });
  test('Lua script mirrors the MULTI body incl. record-on-block + short-circuit', () => {
    const lua = read('backend/services/ai/aiGuardLua.ts');
    expect(lua).toContain("ZREMRANGEBYSCORE");
    expect(lua).toContain("ZCARD");
    expect(lua).toContain("ZADD");
    expect(lua).toContain("EXPIRE");
    // ZADD precedes the block check → blocked request still recorded (JS parity).
    expect(lua.indexOf("redis.call('ZADD'")).toBeLessThan(lua.indexOf('if count >= limit'));
    // Early return on block → later layers untouched (JS short-circuit parity).
    expect(lua).toContain('return {i, count}');
    // Same admin overrides as the JS path.
    expect(aiGuardSrc).toContain('resolveEffectiveRateLimitConfig');
  });
});

describe('W2-2 / W2-8 / W2-9 mechanical batches', () => {
  test('auth validation is single-flighted per token', () => {
    expect(authResolverSrc).toMatch(/singleFlight\(`auth:getUser:\$\{token\}`/);
  });
  test('step-up state joins the identity Promise.all (no trailing await)', () => {
    expect(identitySrc).toMatch(/const \[memberships, activeOrgId, capabilities, mfa, device, stepUp\] = await Promise\.all\(/);
    expect(identitySrc).not.toMatch(/const stepUp = await fetchStepUpState/);
  });
  test('growth report projections load in parallel', () => {
    expect(growthSrc).toMatch(/const \[growthReport, website_intelligence, lead_intelligence\] = await Promise\.all\(/);
  });
});

describe('W2-4 gateway overhead batch', () => {
  test('pricing imports are hoisted (no per-call dynamic import of pricingService)', () => {
    expect(opsSrc).toContain("import { assertModelPricingExists, recordCostAnomaly } from './pricingService';");
    expect(opsSrc).not.toContain("await import('./pricingService')");
  });
  test('llm config resolve is request-memoized behind the flag', () => {
    expect(coreSrc).toMatch(/memoRequest\(`gateway:llmconfig:\$\{companyId\}`, \(\) => resolveLlmConfigUncached\(companyId\)\)/);
  });
  test('audit write awaits by default; fire-and-forget only when the flag is on', () => {
    expect(opsSrc).toMatch(/if \(resolveRolloutSync\(GATEWAY_OVERHEAD_FLAG\)\.mode !== 'off'\) \{\s*\n\s*void auditWrite\(\)/);
    expect(opsSrc).toMatch(/await auditWrite\(\);/);
  });
});

describe('W2-5 keep-alive pool', () => {
  test('flag off → historical fresh-per-call agent; pooling only when on', () => {
    expect(safeFetchSrc).toMatch(/resolveRolloutSync\(OUTBOUND_KEEPALIVE_FLAG\)\.mode !== 'off'\s*\n?\s*\? getPooledAgent\(host, addresses, timeoutMs\)\s*\n?\s*: new Agent\(/);
  });
  test('pool key binds the VALIDATED address set (DNS change → new pinned agent)', () => {
    expect(safeFetchSrc).toMatch(/const key = `\$\{host\}\|\$\{addresses\.map\(\(a\) => a\.address\)\.sort\(\)\.join\(','\)\}\|\$\{timeoutMs\}`/);
    expect(safeFetchSrc).toContain('AGENT_POOL_MAX');
  });
  test('security path unchanged: validation runs per hop in both modes', () => {
    expect(safeFetchSrc).toContain('const addresses = await resolveAndValidate(host, policy);');
    expect(safeFetchSrc.match(/makePinnedLookup\(addresses\)/g)?.length).toBe(2); // pooled + fresh branches
  });
});

describe('W2-6 DDL batch', () => {
  test('migration is additive: targeted indexes + duplicate drops only', () => {
    const sql = read('supabase/migrations/20260905000000_wave2_perf_ddl_batch.sql');
    expect(sql).toContain('idx_scheduled_posts_due_scan');
    expect(sql).toContain("WHERE status = 'scheduled'");
    expect(sql).toContain('idx_credit_transactions_created_at');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_scheduled_posts_campaign;');
    // Statement lines only (comments describe what the batch deliberately
    // does NOT do, so they mention the forbidden words).
    const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/ALTER TABLE|DROP TABLE|CREATE TABLE|MATERIALIZED/i);
  });
});
