/**
 * Mode B funding: own key first; central only when opted in AND a Super
 * Admin-managed key exists; central calls reserve credits priced at vendor
 * cost x 1.5 and are confirmed only when the vendor answered.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no db in this suite'); } }));

import { makeFundedCostPort, makeFundedCredentialPort, unitsForCall } from '../../services/enrichment/providers/funding';
import { PROVIDER_CREDENTIALS } from '../../services/providerCredentialResolver';
import { PricingMissingError } from '../../services/pricingService';

const ORG = '00000000-0000-4000-8000-0000000000aa';

describe('credential order', () => {
  const managed = async () => ({ providerKey: 'apollo_platform', mode: 'SUPER_ADMIN_MANAGED', value: 'PLATFORM', source: 'managed', accountId: 'a1', envName: null, reason: '' }) as never;
  const env = async () => ({ providerKey: 'apollo_platform', mode: 'SUPER_ADMIN_MANAGED', value: 'ENV', source: 'environment', accountId: null, envName: 'X', reason: '' }) as never;

  it('the tenant\'s OWN key wins, even when opted into central access', async () => {
    const port = makeFundedCredentialPort({ tenantCredential: async () => 'OWN', optedIn: async () => true, platformCredential: managed });
    expect(await port.resolveCredential({ organizationId: ORG, providerId: 'apollo' })).toEqual({ value: 'OWN', funding: 'tenant' });
  });

  it('no own key + opted in + a MANAGED platform key -> platform', async () => {
    const port = makeFundedCredentialPort({ tenantCredential: async () => null, optedIn: async () => true, platformCredential: managed });
    expect(await port.resolveCredential({ organizationId: ORG, providerId: 'apollo' })).toEqual({ value: 'PLATFORM', funding: 'platform' });
  });

  it('not opted in -> nothing, and the platform key is never even resolved', async () => {
    const platform = jest.fn(managed);
    const port = makeFundedCredentialPort({ tenantCredential: async () => null, optedIn: async () => false, platformCredential: platform });
    expect(await port.resolveCredential({ organizationId: ORG, providerId: 'apollo' })).toBeNull();
    expect(platform).not.toHaveBeenCalled();
  });

  it('an ENVIRONMENT-sourced platform key is refused (owner: set in Super Admin)', async () => {
    const port = makeFundedCredentialPort({ tenantCredential: async () => null, optedIn: async () => true, platformCredential: env });
    expect(await port.resolveCredential({ organizationId: ORG, providerId: 'apollo' })).toBeNull();
  });

  it('a vendor with no central key can only use the tenant\'s own', async () => {
    const port = makeFundedCredentialPort({ tenantCredential: async () => null, optedIn: async () => true, platformCredential: managed });
    expect(await port.resolveCredential({ organizationId: ORG, providerId: 'clearbit' })).toBeNull();
  });

  it('the platform descriptor declares NO environment names', () => {
    expect(PROVIDER_CREDENTIALS.apollo_platform).toMatchObject({ mode: 'SUPER_ADMIN_MANAGED', envNames: [], honourSourceToggle: true });
  });
});

describe('central cost: reserve -> confirm/release', () => {
  const base = { organizationId: ORG, providerId: 'apollo', attributes: ['employee_count'], correlationId: 'corr-1', subject: 'account' as const, entityId: 'acct-1' };
  const handle = { status: 'reserved', orgId: ORG, userId: ORG, action: 'prospect_enrichment', referenceType: 'prospect_enrichment', referenceId: 'r', idempotencyKey: 'k', holdTransactionId: 'hold-9', creditsReserved: 15, split: {} };
  const deps = () => {
    const calls: string[] = [];
    return {
      calls,
      price: jest.fn(async () => ({ credits: 15, cost_multiplier: 1.5 }) as never),
      reserve: jest.fn(async (o: { amountOverride?: number }) => { calls.push(`reserve:${o.amountOverride}`); return handle as never; }),
      confirm: jest.fn(async () => { calls.push('confirm'); return { status: 'confirmed' } as never; }),
      release: jest.fn(async () => { calls.push('release'); return { status: 'released' } as never; }),
    };
  };

  it('own-key calls never touch credits', async () => {
    const d = deps();
    const port = makeFundedCostPort(d);
    const decision = await port.authorizeCost({ ...base, funding: 'tenant' });
    expect(decision).toMatchObject({ authorized: true, holdId: null });
    expect(d.reserve).not.toHaveBeenCalled();
    await port.settleCost!({ holdId: null, funding: 'tenant', billable: true, outcome: 'enriched', correlationId: 'corr-1', reason: '' });
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('a central call reserves the PRICED credits for the subject\'s units, then confirms when billable', async () => {
    const d = deps();
    const port = makeFundedCostPort(d);
    const decision = await port.authorizeCost({ ...base, funding: 'platform' });
    expect(decision).toMatchObject({ authorized: true, holdId: 'hold-9' });
    expect(d.price).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apollo', unit: 'credit', units: 1, actionKey: 'prospect_enrichment', orgId: ORG }));
    await port.settleCost!({ holdId: 'hold-9', funding: 'platform', billable: true, outcome: 'no_match', correlationId: 'corr-1', reason: 'miss' });
    expect(d.calls).toEqual(['reserve:15', 'confirm']);
  });

  it('a non-billable outcome releases; settling twice charges nothing more', async () => {
    const d = deps();
    const port = makeFundedCostPort(d);
    await port.authorizeCost({ ...base, funding: 'platform' });
    await port.settleCost!({ holdId: 'hold-9', funding: 'platform', billable: false, outcome: 'rate_limited', correlationId: 'corr-1', reason: 'x' });
    await port.settleCost!({ holdId: 'hold-9', funding: 'platform', billable: true, outcome: 'enriched', correlationId: 'corr-1', reason: 'x' });
    expect(d.calls).toEqual(['reserve:15', 'release']);
  });

  it('NO vendor cost in Super Admin -> refused before any reservation or call', async () => {
    const d = deps();
    d.price.mockRejectedValueOnce(new PricingMissingError('apollo', 'credit', 'unit'));
    const decision = await makeFundedCostPort(d).authorizeCost({ ...base, funding: 'platform' });
    expect(decision.authorized).toBe(false);
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it('insufficient credits -> refused (cost_denied path), nothing confirmed', async () => {
    const d = deps();
    d.reserve.mockResolvedValueOnce({ status: 'insufficient_credits', available: 3, required: 15 } as never);
    const decision = await makeFundedCostPort(d).authorizeCost({ ...base, funding: 'platform' });
    expect(decision.authorized).toBe(false);
    if ('reason' in decision) expect(decision.reason).toContain('insufficient_credits');
  });

  it('the platform-wide backstop can refuse before pricing', async () => {
    const d = deps();
    const port = makeFundedCostPort({ ...d, allow: async () => 'platform daily ceiling reached' });
    expect(await port.authorizeCost({ ...base, funding: 'platform' })).toEqual({ authorized: false, reason: 'platform daily ceiling reached' });
    expect(d.price).not.toHaveBeenCalled();
  });

  it('units are declared per vendor and subject', () => {
    expect(unitsForCall('apollo', 'person')).toEqual({ unit: 'credit', units: 1 });
    expect(unitsForCall('clearbit', 'account')).toBeNull();
  });
});
