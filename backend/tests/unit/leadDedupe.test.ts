import { computeLeadDedupeKey, type CanonicalLeadInput } from '../../../lib/leadIntelligence';

const base = (over: Partial<CanonicalLeadInput> = {}): CanonicalLeadInput => ({
  organizationId: 'co1', source: 'website', identity: {},
  attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  ...over,
});

describe('Lead dedupe key (idempotency)', () => {
  it('same source row → same key', () => {
    const a = base({ sourceRef: { table: 'leads', id: 'l1' } });
    const b = base({ sourceRef: { table: 'leads', id: 'l1' }, status: 'changed' });
    expect(computeLeadDedupeKey(a)).toBe(computeLeadDedupeKey(b));
  });
  it('different source rows → different keys', () => {
    expect(computeLeadDedupeKey(base({ sourceRef: { table: 'leads', id: 'l1' } })))
      .not.toBe(computeLeadDedupeKey(base({ sourceRef: { table: 'leads', id: 'l2' } })));
  });
  it('falls back to source+person+occurrence when no source id', () => {
    const k = computeLeadDedupeKey(base({ identity: { unifiedPersonId: 'up1' }, occurredAt: '2026-01-01' }));
    expect(k).toContain('person:up1');
    expect(k).toContain('src:website');
  });
});
