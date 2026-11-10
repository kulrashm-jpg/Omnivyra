/**
 * Mode B: funding flows from the credential to the cost port, and every paid
 * call is SETTLED (confirm if the vendor answered, release otherwise). Without
 * a settle port the executor behaves exactly as before.
 */
import { executeEnrichment, readResolvedCredential, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter, EnrichmentRequest, ProviderResponse } from '../../services/enrichment/providers/contract';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const req = (): EnrichmentRequest => ({
  organizationId: ORG, subject: 'account', entityId: 'acct-1', attributes: ['employee_count'],
  selectors: { domain: 'x.com' }, purpose: 't', correlationId: 'corr-1',
} as EnrichmentRequest);

const answer = (outcome: ProviderResponse['outcome'], value: unknown = 250): ProviderResponse => (
  outcome === 'enriched'
    ? { outcome, fields: [{ attribute: 'employee_count', subject: 'account', value, observedAt: null, confidence: null, providerInferred: false }], notReturned: [] }
    : { outcome, fields: [], notReturned: ['employee_count'] });

function setup(opts: { credential?: unknown; respond?: () => Promise<ProviderResponse>; persistThrows?: boolean; settle?: boolean } = {}) {
  const log: string[] = [];
  const adapter: EnrichmentProviderAdapter = {
    id: 'apollo', label: 'Apollo', supports: ['employee_count'], credentialEnvVar: null, isAvailable: () => false,
    enrich: async () => { log.push('CALL'); return (opts.respond ?? (async () => answer('enriched')))(); },
  };
  const ports: ExecuteEnrichmentPorts = {
    async authorizeCost(i) { log.push(`authorize:${i.funding}:${i.subject}:${i.entityId}`); return { authorized: true, holdId: 'hold-1', cost: { kind: 'unknown' } }; },
    async releaseCost(h, r) { log.push(`release:${h}:${r}`); },
    async resolveCredential() { return (opts.credential ?? { value: 'k', funding: 'platform' }) as never; },
    async findRecentObservation() { return null; },
    async persistObservation() { if (opts.persistThrows) throw new Error('db down'); return { sourceRecordId: 's', canonicalWithheld: [] }; },
    now: () => '2026-11-10T00:00:00.000Z',
    ...(opts.settle === false ? {} : {
      async settleCost(i) { log.push(`settle:${i.funding}:${i.billable}:${i.outcome}`); },
    }),
  };
  return { log, run: () => executeEnrichment(req(), 'apollo', ports, { adapter }) };
}

describe('funding', () => {
  it('a bare-string credential is the original contract: tenant-funded', () => {
    expect(readResolvedCredential('k')).toEqual({ value: 'k', funding: 'tenant' });
    expect(readResolvedCredential({ value: 'k', funding: 'platform' })).toEqual({ value: 'k', funding: 'platform' });
    for (const bad of ['', '  ', null, undefined, { value: '', funding: 'platform' }, { value: 'k', funding: 'other' }]) {
      expect(readResolvedCredential(bad as never)).toBeNull();
    }
  });

  it('platform funding reaches authorizeCost with subject and entity, and the result says who paid', async () => {
    const { log, run } = setup();
    const out = await run();
    expect(log[0]).toBe('authorize:platform:account:acct-1');
    expect(out.funding).toBe('platform');
  });

  it('an unusable credential is credential_missing, before any cost or call', async () => {
    const { log, run } = setup({ credential: { value: 'k', funding: 'nobody' } });
    expect((await run()).outcome).toBe('credential_missing');
    expect(log).toEqual([]);
  });
});

describe('settlement with a settle port (mode B)', () => {
  it('enriched -> settled billable, after persistence', async () => {
    const { log, run } = setup();
    await run();
    expect(log).toEqual(['authorize:platform:account:acct-1', 'CALL', 'settle:platform:true:enriched']);
  });

  it.each([['no_match'], ['field_not_found']] as const)('a vendor miss (%s) is billable (the vendor billed it)', async (o) => {
    const { log, run } = setup({ respond: async () => answer(o) });
    await run();
    expect(log.at(-1)).toBe(`settle:platform:true:${o}`);
  });

  it.each([['rate_limited'], ['provider_unavailable'], ['quota_exceeded']] as const)('%s is NOT billable', async (o) => {
    const { log, run } = setup({ respond: async () => answer(o) });
    await run();
    expect(log.at(-1)).toBe(`settle:platform:false:${o}`);
  });

  it('a thrown transport error is NOT billable', async () => {
    const { log, run } = setup({ respond: async () => { throw new Error('ECONNRESET'); } });
    await run();
    expect(log.at(-1)).toMatch(/^settle:platform:false:/);
  });

  it('persistence failing after a paid answer RELEASES (tenant got nothing) and rethrows', async () => {
    const { log, run } = setup({ persistThrows: true });
    await expect(run()).rejects.toThrow('db down');
    expect(log.at(-1)).toBe('settle:platform:false:enriched');
    expect(log.filter((l) => l.startsWith('settle')).length).toBe(1);
  });
});

describe('without a settle port: EXACTLY the original behaviour', () => {
  it('success: nothing released', async () => {
    const { log, run } = setup({ settle: false, credential: 'k' });
    await run();
    expect(log.some((l) => l.startsWith('release'))).toBe(false);
  });

  it('a miss and an error each release the hold', async () => {
    const miss = setup({ settle: false, credential: 'k', respond: async () => answer('no_match') });
    await miss.run();
    expect(miss.log.at(-1)).toBe('release:hold-1:no usable field: no_match');
    const err = setup({ settle: false, credential: 'k', respond: async () => { throw new Error('x'); } });
    await err.run();
    expect(err.log.at(-1)).toMatch(/^release:hold-1:provider error:/);
  });
});
