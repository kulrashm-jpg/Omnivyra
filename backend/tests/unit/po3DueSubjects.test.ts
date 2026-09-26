/**
 * PO-3 — due-subject selection, fan-out bounds, and the cron registration.
 *
 * WHY THIS SUITE EXISTS. The scheduler is where a careful evidence design can still become an
 * expensive or dishonest one, in three specific ways:
 *
 *  • treating a BLOCKED observation as a success would suppress re-acquisition, leaving a report
 *    permanently unable to look while appearing to have looked;
 *  • letting a previous domain's observation satisfy the current domain's due check would serve
 *    advertising evidence about a site the customer no longer runs;
 *  • removing a fan-out bound would turn a daily job into thousands of page loads against a
 *    third-party surface.
 *
 * Each is pinned below.
 *
 * SECRETS: none. `isDue` is pure; the registration checks read source text.
 */
import fs from 'fs';
import path from 'path';
import { isDue } from '../../services/ads/adsDueSubjects';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();

describe('isDue — daily cadence with bounded retry', () => {
  it('is due when nothing has ever been observed', () => {
    expect(isDue({ now: NOW, history: [] })).toBe(true);
  });

  it('is NOT due within 24h of a successful observation', () => {
    expect(isDue({ now: NOW, history: [{ observedAt: at(2), accessState: 'observed' }] })).toBe(false);
    expect(isDue({ now: NOW, history: [{ observedAt: at(23), accessState: 'observed' }] })).toBe(false);
  });

  it('is due again once the success is older than 24h', () => {
    expect(isDue({ now: NOW, history: [{ observedAt: at(25), accessState: 'observed' }] })).toBe(true);
  });

  it.each(['blocked', 'restricted', 'requires_auth', 'unreachable', 'unavailable'])(
    'a %s observation is an attempt, never a success',
    (state) => {
      // Within the retry gap it still suppresses (bounded retry)…
      expect(isDue({ now: NOW, history: [{ observedAt: at(1), accessState: state }] })).toBe(false);
      // …but once the gap passes it is due again, unlike a success, which holds for 24h.
      expect(isDue({ now: NOW, history: [{ observedAt: at(7), accessState: state }] })).toBe(true);
    },
  );

  it('bounds retries rather than retrying every cycle', () => {
    // A persistently blocked provider retries on the 6h gap, not on every tick.
    expect(isDue({ now: NOW, history: [{ observedAt: at(5), accessState: 'blocked' }] })).toBe(false);
    expect(isDue({ now: NOW, history: [{ observedAt: at(6.5), accessState: 'blocked' }] })).toBe(true);
  });

  it('uses the most recent success even when later attempts failed', () => {
    expect(isDue({
      now: NOW,
      history: [
        { observedAt: at(7), accessState: 'blocked' },
        { observedAt: at(10), accessState: 'observed' },
      ],
    })).toBe(false); // the 10h-old success still holds the daily cadence
  });

  it('ignores unparseable timestamps rather than treating them as now', () => {
    expect(isDue({ now: NOW, history: [{ observedAt: 'not-a-date', accessState: 'observed' }] })).toBe(true);
  });
});

describe('due-subject selection — source-level guarantees', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'backend/services/ads/adsDueSubjects.ts'),
    'utf8',
  );

  it('scopes the due check by company AND domain', () => {
    // Either filter alone is a defect: company-only lets a previous domain's observation
    // suppress the current one.
    expect(src).toMatch(/\.eq\('company_id', companyId\)/);
    expect(src).toMatch(/scope\?\.domain_id \?\? null\) === domainId/);
  });

  it('excludes subjects without a usable public domain', () => {
    expect(src).toMatch(/if \(!companyId \|\| !domainId \|\| !domain\) continue;/);
  });

  it('prevents a subject/domain pair appearing twice in one cycle', () => {
    expect(src).toContain('seen.has(key)');
    expect(src).toMatch(/const key = `\$\{companyId\}\|\$\{domainId\}`/);
  });

  it('reads eligibility from canonical_domains rather than a new model', () => {
    expect(src).toContain("from('canonical_domains')");
    expect(src).not.toMatch(/create table|ads_schedule|acquisition_queue/i);
  });

  it('takes the legal name from the site, never from the company profile', () => {
    // company_profiles is the customer's own assertion and cannot corroborate a
    // provider-verified name.
    expect(src).toContain("from('canonical_pages')");
    expect(src).not.toContain("from('company_profiles')");
  });

  it('stops at the requested limit', () => {
    expect(src).toContain('if (out.length >= limit) break;');
  });
});

/**
 * Comments stripped, so every assertion below is about code that RUNS.
 *
 * The first draft of this suite matched raw source and failed on its own documentation: the
 * registration's comment names `storageState` precisely to say it is never used, and names
 * `runAdsAcquisitionCycle` while explaining the flag. A guard that a comment can satisfy — or
 * break — is not a guard.
 */
function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('cron registration', () => {
  const cron = executable(fs.readFileSync(path.join(process.cwd(), 'backend/scheduler/cron.ts'), 'utf8'));

  it('registers the acquisition cycle exactly once', () => {
    expect(cron.match(/'adsTransparencyAcquisition'/g) ?? []).toHaveLength(1);
    // Once to import, once to call — and no second registration anywhere.
    expect(cron.match(/runAdsAcquisitionCycle/g) ?? []).toHaveLength(2);
    expect(cron.match(/ADS_ACQUISITION_INTERVAL_MS/g) ?? []).toHaveLength(2);
  });

  it('uses a daily cadence, not hourly', () => {
    expect(cron).toContain('const ADS_ACQUISITION_INTERVAL_MS = 24 * 60 * 60 * 1000;');
  });

  it('reuses the existing scheduleWorker lifecycle rather than a second scheduler', () => {
    expect(cron).toMatch(/scheduleWorker\(\s*async \(\) => \{\s*const \{ runAdsAcquisitionCycle \}/);
    expect(cron).not.toMatch(/setInterval\([^)]*ads/i);
  });

  it('never supplies an authenticated browser session', () => {
    const block = cron.slice(cron.indexOf('runAdsAcquisitionCycle'), cron.indexOf("'adsTransparencyAcquisition'"));
    expect(block).toContain('browser.newContext()');
    // In executable code: no stored session, no RPA session loader, no authenticated runner.
    expect(block).not.toMatch(/storageState|loadRpaSession|rpaPlaywrightRunner/);
  });

  it('does not enable the flag anywhere in code', () => {
    // The registration must start nothing. Only a separately authorized release may flip it.
    expect(cron.match(/ADS_TRANSPARENCY_ACQUISITION_ENABLED\s*=/g) ?? []).toHaveLength(0);
  });
});

describe('fan-out bounds are retained', () => {
  const scheduler = fs.readFileSync(path.join(process.cwd(), 'backend/services/ads/adsAcquisitionScheduler.ts'), 'utf8');
  const client = fs.readFileSync(path.join(process.cwd(), 'backend/services/ads/adsTransparencyBrowserClient.ts'), 'utf8');
  const observation = fs.readFileSync(path.join(process.cwd(), 'backend/services/ads/adsTransparencyObservation.ts'), 'utf8');

  it('caps subjects per cycle at 5', () => {
    expect(scheduler).toContain('const DEFAULT_MAX_SUBJECTS = 5;');
  });

  it('caps AR resolutions per search at 4', () => {
    expect(client).toContain('const MAX_RESOLVE_PER_SEARCH = 4;');
  });

  it('caps advertiser profiles opened per subject at 6', () => {
    expect(observation).toContain('const DEFAULT_MAX_PROFILES = 6;');
  });

  it('keeps the cycle sequential — no parallel browser fan-out', () => {
    expect(scheduler).toMatch(/for \(const entry of subjects\)/);
    expect(scheduler).not.toMatch(/Promise\.all\(\s*subjects/);
  });
});
