/**
 * WS1-E6-T006 — Group A backend idempotency adoption gate + behaviour.
 *
 * ADOPTION GATE (permanent, three-way). It fails when:
 *   1. an authorized endpoint LOSES withIdempotency,
 *   2. a new authorized endpoint is added without adoption,
 *   3. an UNAUTHORIZED endpoint adopts it — Group B dormant endpoints and the
 *      three billing endpoints remain blocked by OR-08/ED-01, so silent
 *      adoption there must break the build too.
 *
 * BEHAVIOUR. The middleware's semantics are proven exhaustively in
 * withIdempotencyCallerScoping.test.ts against the real implementation. What
 * needs proving HERE is that each endpoint is wired such that those semantics
 * actually apply to it: the wrapper sits inside the route factory, the
 * handler's own authorization still runs, and each endpoint owns a distinct
 * replay namespace.
 *
 * No database, no network.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

/** OR-08 Group A — the ONLY endpoints authorized to adopt. */
const AUTHORIZED: Array<[string, string]> = [
  ['pages/api/social/publish.ts', 'social-publish'],
  ['pages/api/blogs/[id]/publish.ts', 'blogs-publish'],
  ['pages/api/activity-workspace/schedule.ts', 'activity-workspace-schedule'],
  ['pages/api/activity-workspace/[id]/reschedule.ts', 'activity-workspace-reschedule'],
  ['pages/api/activity-workspace/[id]/unschedule.ts', 'activity-workspace-unschedule'],
  ['pages/api/campaigns/[id]/repurpose-and-schedule.ts', 'campaigns-repurpose-and-schedule'],
  ['pages/api/campaigns/[id]/schedule-structured-plan.ts', 'campaigns-schedule-structured-plan'],
];

/** Blocked by OR-08 (Group B dormant) and ED-01 (billing held pending telemetry). */
const MUST_NOT_ADOPT = [
  'pages/api/billing/checkout/create-order.ts',
  'pages/api/billing/checkout/verify.ts',
  'pages/api/billing/profile.ts',
  'pages/api/billing/context.ts',
  'pages/api/credits/earn/feedback.ts',
  'pages/api/credits/earn/referral.ts',
  'pages/api/credits/earn/setup-progress.ts',
  'pages/api/publishing/reconcile/run.ts',
  'pages/api/publishing/worker/run.ts',
  'pages/api/social/post.ts',
  'pages/api/social/comments.ts',
];

describe('adoption gate — authorized endpoints', () => {
  it.each(AUTHORIZED)('%s adopts withIdempotency', (rel) => {
    expect({ file: rel, adopted: read(rel).includes('withIdempotency(handler') })
      .toEqual({ file: rel, adopted: true });
  });

  it.each(AUTHORIZED)('%s uses its own replay namespace', (rel, scope) => {
    expect(read(rel)).toContain(`scope: '${scope}'`);
  });

  it('every scope is distinct — no endpoint can replay another', () => {
    const scopes = AUTHORIZED.map(([, s]) => s);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it('the authorized list is exactly the seven Group A endpoints', () => {
    expect(AUTHORIZED).toHaveLength(7);
    AUTHORIZED.forEach(([rel]) => expect(exists(rel)).toBe(true));
  });
});

describe('adoption gate — unauthorized endpoints must NOT adopt', () => {
  it.each(MUST_NOT_ADOPT)('%s remains unadopted', (rel) => {
    if (!exists(rel)) return; // route removed by a lifecycle decision
    expect({ file: rel, adopted: read(rel).includes('withIdempotency') })
      .toEqual({ file: rel, adopted: false });
  });
});

describe('adoption gate — no adoption outside the sanctioned set', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const child = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(child, out);
      else if (e.name.endsWith('.ts')) out.push(child);
    }
    return out;
  };

  it('only Group A and the 29 pre-existing adopters use the middleware', () => {
    const adopters = walk('pages/api').filter((rel) => read(rel).includes('withIdempotency'));
    const groupA = new Set(AUTHORIZED.map(([rel]) => rel));
    const unexpected = adopters.filter(
      (rel) => !groupA.has(rel) && !/^pages\/api\/(admin|super-admin|team|company|credits\/claim-action)/.test(rel),
    );
    // Anything else adopting is an unauthorized expansion of scope.
    expect(unexpected).toEqual([]);
  });

  it('the pre-existing adopter count has not shrunk', () => {
    const all = walk('pages/api').filter((rel) => read(rel).includes('withIdempotency'));
    // 29 pre-existing + 7 Group A.
    expect(all.length).toBeGreaterThanOrEqual(36);
  });
});

describe('wiring — the middleware can actually take effect', () => {
  it.each(AUTHORIZED)('%s nests withIdempotency INSIDE the route factory', (rel) => {
    // __createApiRoute(withIdempotency(handler, …), …) — reversing this would
    // put the replay cache outside request-context seeding.
    expect(read(rel)).toMatch(/__createApiRoute\(\s*withIdempotency\(handler,/);
  });

  it.each(AUTHORIZED)('%s still performs its own authorization inside the handler', (rel) => {
    // Caller scoping makes replay same-caller-only; the handler must still be
    // the thing that decides tenant/role access on a cache MISS.
    const src = read(rel);
    const authorizes =
      /getSupabaseUserFromRequest|enforceCompanyAccess|enforceRole|requireCampaignAccess|resolveAuthenticatedUser/.test(src);
    expect({ file: rel, authorizes }).toEqual({ file: rel, authorizes: true });
  });

  it.each(AUTHORIZED)('%s responds only via res.json, so replay can capture it', (rel) => {
    // withIdempotency patches res.json only. An endpoint using send/end/redirect
    // would leave its record stuck in `processing` until the stale lock expires.
    const src = read(rel);
    expect({ file: rel, unsupported: /res\.send\(|res\.end\(|res\.redirect\(/.test(src) })
      .toEqual({ file: rel, unsupported: false });
  });

  it.each(AUTHORIZED)('%s imports the shared middleware — no local reimplementation', (rel) => {
    expect(read(rel)).toMatch(/import \{ withIdempotency \} from '[^']*backend\/middleware\/withIdempotency'/);
  });
});
