/**
 * ONBOARD-001 — source contracts (wiring locks; no DB writes, shared-prod safe).
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const containsAll = (src: string, tokens: string[]) => { for (const t of tokens) expect(src).toContain(t); };

describe('ONBOARD-001 §4 — canonical domain registry dual-write', () => {
  test('setup-company writes company_domains via the governed writer at creation', () => {
    const src = read('pages/api/onboarding/setup-company.ts');
    containsAll(src, [
      "import { saveDomainRecord } from '../../../backend/services/domainRecordService'",
      'await saveDomainRecord({',
      "created_via:         'system'",
      "domainResult.error !== 'DOMAIN_ALREADY_CLAIMED'", // conflict-tolerant, non-fatal
    ]);
  });

  test('backfill migration is additive and non-destructive', () => {
    const sql = read('supabase/migrations/20260714_onboard001_journey_and_domains.sql');
    containsAll(sql, ['journey_state JSONB', 'INSERT INTO company_domains', 'ON CONFLICT DO NOTHING']);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });
});

describe('ONBOARD-001 §3/§7 — enrichment reuses the single crawl', () => {
  test('crawlWebsiteSources returns metadata from the already-fetched root HTML', () => {
    const src = read('backend/services/companyProfile/refinementHelpers.ts');
    containsAll(src, ['extractWebsiteMetadata', 'metadata: DiscoveredWebsiteMetadata | null']);
    // CKRE-001 §2/§7: the root now goes through the crawl-reuse cache
    // (fetchPageCached), which de-duplicates fetches across the workflow. There
    // must be exactly one root fetch and no direct safeFetch of the root.
    const rootFetches = (src.match(/fetchPageCached\(normalizedWebsite/g) ?? []).length;
    expect(rootFetches).toBe(1);
    expect(src.match(/safeFetch\(normalizedWebsite/g)).toBeNull();
  });

  test('setup-company persists discovered brand assets + metadata bundle + timezone', () => {
    const src = read('pages/api/onboarding/setup-company.ts');
    containsAll(src, [
      'crawlResult.metadata',
      'logo_url:    discoveredMetadata?.logoUrl',
      'favicon_url: discoveredMetadata?.faviconUrl',
      'discovered_metadata:',
      "source: 'system_discovered'",
      "from('company_scheduler_prefs')",
      'timezone: clientTimezone',
    ]);
  });

  test('client sends the browser IANA timezone', () => {
    expect(read('pages/onboarding/company.tsx')).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
  });
});

describe('ONBOARD-001 §5/§12 — journey endpoint', () => {
  test('GET/POST journey endpoint reuses the canonical authority + verification gate', () => {
    const src = read('pages/api/onboarding/journey.ts');
    containsAll(src, [
      'buildOnboardingJourney',
      'applyJourneyStageAction',
      "code: 'EMAIL_NOT_VERIFIED'",       // POST gate (AUTH-001 reuse)
      'journey.companyId',                 // company derived server-side, not trusted from client
    ]);
  });

  test('the guided journey page renders from the server truth, not client math', () => {
    const src = read('pages/onboarding/journey.tsx');
    containsAll(src, ["apiFetch('/api/onboarding/journey')", 'platformReady', 'Skip for now']);
  });
});
