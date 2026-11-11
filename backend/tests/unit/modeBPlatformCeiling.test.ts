/**
 * Mode B: the platform-wide daily ceiling on central (platform-key) calls and
 * the optional per-tenant share (default OFF). Fails closed.
 */
import { makePlatformDailyCeiling } from '../../services/enrichment/providers/platformCeiling';
import { makeFundedCostPort } from '../../services/enrichment/providers/funding';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-10T15:30:00.000Z');

function ceiling(opts: { ceiling?: unknown; share?: unknown; platformUsed?: number | null; tenantUsed?: number | null }) {
  const seen: Array<{ sinceIso: string; organizationId?: string }> = [];
  const allow = makePlatformDailyCeiling({
    now: () => NOW,
    readPolicy: async (key) => (key === 'central_vendor_daily_ceiling' ? opts.ceiling ?? null : opts.share ?? null),
    countHolds: async (i) => { seen.push(i); const v = i.organizationId ? opts.tenantUsed : opts.platformUsed; return v === undefined ? 0 : v; },
  });
  return { allow: () => allow({ organizationId: ORG, providerId: 'apollo' }), seen };
}

it('FAILS CLOSED: no ceiling configured -> central access refused', async () => {
  expect(await ceiling({}).allow()).toBe('central_ceiling_not_configured');
  expect(await ceiling({ ceiling: { apollo: 0 } }).allow()).toBe('central_ceiling_not_configured');
  expect(await ceiling({ ceiling: { other: 100 } }).allow()).toBe('central_ceiling_not_configured');
  expect(await ceiling({ ceiling: { apollo: 'lots' } }).allow()).toBe('central_ceiling_not_configured');
});

it('FAILS CLOSED: an unreadable count refuses', async () => {
  expect(await ceiling({ ceiling: { apollo: 100 }, platformUsed: null }).allow()).toBe('central_ceiling_unreadable');
});

it('under the ceiling -> allowed; counts holds since 00:00 UTC TODAY', async () => {
  const c = ceiling({ ceiling: { apollo: 100 }, platformUsed: 99 });
  expect(await c.allow()).toBeNull();
  expect(c.seen[0]).toEqual({ sinceIso: '2026-11-10T00:00:00.000Z' });
});

it('at the ceiling -> refused', async () => {
  expect(await ceiling({ ceiling: { apollo: 100 }, platformUsed: 100 }).allow()).toBe('central_daily_ceiling_reached');
});

it('per-tenant share is OFF by default: a tenant may use the whole remaining ceiling', async () => {
  const c = ceiling({ ceiling: { apollo: 100 }, platformUsed: 10, tenantUsed: 90 });
  expect(await c.allow()).toBeNull();
  expect(c.seen.some((s) => s.organizationId)).toBe(false);   // not even counted
});

it('per-tenant share ON: a tenant at its share is refused; NEGATIVE CONTROL under it is allowed', async () => {
  const share = { enabled: true, max_fraction: 0.25 };
  expect(await ceiling({ ceiling: { apollo: 100 }, share, platformUsed: 30, tenantUsed: 25 }).allow()).toBe('central_tenant_share_reached');
  expect(await ceiling({ ceiling: { apollo: 100 }, share, platformUsed: 30, tenantUsed: 24 }).allow()).toBeNull();
});

it('per-tenant share ON but malformed -> refused (never silently unlimited)', async () => {
  expect(await ceiling({ ceiling: { apollo: 100 }, share: { enabled: true, max_fraction: 2 } }).allow()).toBe('central_tenant_share_misconfigured');
});

describe('wired into the funded cost port', () => {
  const input = { organizationId: ORG, providerId: 'apollo', attributes: ['job_title'], correlationId: 'c1', subject: 'person' as const };

  it('a PLATFORM call over the ceiling is refused BEFORE any pricing or reservation', async () => {
    const calls: string[] = [];
    const port = makeFundedCostPort({
      allow: async () => 'central_daily_ceiling_reached',
      price: (async () => { calls.push('price'); throw new Error('x'); }) as never,
      reserve: (async () => { calls.push('reserve'); throw new Error('x'); }) as never,
    });
    const d = await port.authorizeCost({ ...input, funding: 'platform' } as never);
    expect(d).toEqual({ authorized: false, reason: 'central_daily_ceiling_reached' });
    expect(calls).toEqual([]);
  });

  it('NEGATIVE CONTROL: a TENANT (own key) call never consults the ceiling', async () => {
    let consulted = false;
    const port = makeFundedCostPort({ allow: async () => { consulted = true; return 'central_daily_ceiling_reached'; } });
    const d = await port.authorizeCost({ ...input, funding: 'tenant' } as never);
    expect(consulted).toBe(false);
    expect('authorized' in d && d.authorized).toBe(true);
  });
});
