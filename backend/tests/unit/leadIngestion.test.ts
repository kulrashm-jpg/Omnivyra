import { ingestCanonicalLead, ingestFromSource, routeToCanonicalInput, type IngestionPorts, type CanonicalLead } from '../../../lib/leadIntelligence';

function makePorts(resolved: { unifiedPersonId: string | null; matchedBy?: string } = { unifiedPersonId: 'up_1', matchedBy: 'email' }) {
  const emitted: CanonicalLead[] = [];
  const calls: Array<Record<string, unknown>> = [];
  const p: IngestionPorts = {
    identity: { async resolve(input) { calls.push(input as Record<string, unknown>); return resolved; } },
    sink: { async emit(l) { emitted.push(l); } },
    now: () => '2026-06-29T00:00:00.000Z',
  };
  return { p, emitted, calls };
}

describe('Canonical ingestion pipeline', () => {
  it('resolves identity via the port and emits to the sink', async () => {
    const { p, emitted, calls } = makePorts();
    const lead = await ingestFromSource('website', { company_id: 'co1', email: 'a@b.com', source: 'form_embed' }, p);
    expect(calls).toHaveLength(1);
    expect(calls[0].organizationId).toBe('co1');
    expect(lead.unifiedPersonId).toBe('up_1');
    expect(lead.identityMatchedBy).toBe('email');
    expect(lead.ingestedAt).toBe('2026-06-29T00:00:00.000Z');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].source).toBe('website');
  });

  it('passes platform identity into externalKeys for the resolver', async () => {
    const { p, calls } = makePorts({ unifiedPersonId: 'up_2', matchedBy: 'external_keys' });
    await ingestFromSource('engagement', { organization_id: 'org1', platform: 'linkedin', platform_user_id: 'u42' }, p);
    expect((calls[0].externalKeys as Record<string, unknown>)['linkedin:user']).toBe('u42');
  });

  it('skips identity resolution when no identity hints exist', async () => {
    const { p, calls, emitted } = makePorts();
    await ingestCanonicalLead(routeToCanonicalInput('marketpulse', { company_id: 'co1', signal_category: 'hiring', title: 't' }), p);
    expect(calls).toHaveLength(0);
    expect(emitted[0].unifiedPersonId).toBeNull();
  });

  it('preserves attribution end-to-end', async () => {
    const { p, emitted } = makePorts();
    await ingestFromSource('website', { company_id: 'co1', email: 'a@b.com', utm_source: 'g', campaign: 'q3', custom_field: 'keep' }, p);
    expect(emitted[0].attribution.utm.source).toBe('g');
    expect(emitted[0].attribution.campaign).toBe('q3');
    expect(emitted[0].attribution.sourceMetadata.custom_field).toBe('keep');
  });

  it('throws on missing organizationId', async () => {
    const { p } = makePorts();
    await expect(ingestCanonicalLead({
      organizationId: '', source: 'manual', identity: {},
      attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
    }, p)).rejects.toThrow('organizationId');
  });
});
