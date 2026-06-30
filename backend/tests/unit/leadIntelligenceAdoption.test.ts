/**
 * Phase 3 — proves every adopted source routes through the Canonical Lead
 * Intelligence facade with identity reuse + attribution preservation, and that
 * adoption is fail-open (backward compatible). Server deps are mocked so the
 * runtime module loads in isolation; routing is exercised via an override ingestor.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({}) }));
jest.mock('../../services/identityResolutionService', () => ({ resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'up_default', matchedBy: 'email', created: false })) }));
jest.mock('../../services/auditLoggingService', () => ({ logAuditEvent: jest.fn(async () => {}) }));

import { adoptLeadAsync } from '../../services/leadIntelligence/leadIntelligenceRuntime';
import { createLeadIntelligenceIngestor } from '../../services/leadIntelligence/leadIntelligenceFacade';
import { createInMemorySink } from '../../services/leadIntelligence/leadIntelligencePorts';
import type { IdentityResolverPort, CanonicalLeadSource } from '../../../lib/leadIntelligence';

function harness() {
  const { sink, emitted } = createInMemorySink();
  const resolve = jest.fn(async () => ({ unifiedPersonId: 'fake_up', matchedBy: 'email' }));
  const identity: IdentityResolverPort = { resolve };
  const ingestor = createLeadIntelligenceIngestor({ sink, identity, now: () => 't' });
  return { ingestor, emitted, resolve };
}

const ROWS: Array<{ name: string; adapter: CanonicalLeadSource; row: Record<string, unknown>; expected: CanonicalLeadSource; identity: boolean }> = [
  { name: 'Website',     adapter: 'website',     row: { id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed', utm_source: 'g', campaign: 'q3', custom_field: 'keep' }, expected: 'website',  identity: true },
  { name: 'Forms',       adapter: 'website',     row: { id: 'l2', company_id: 'co1', email: 'f@b.com', source: 'form_embed', form_id: 'fm1' }, expected: 'website',  identity: true },
  { name: 'Manual',      adapter: 'website',     row: { id: 'l3', company_id: 'co1', email: 'm@b.com', source: 'manual' }, expected: 'manual',   identity: true },
  { name: 'Webhook',     adapter: 'website',     row: { id: 'l4', company_id: 'co1', email: 'w@b.com', source: 'webhook' }, expected: 'webhook',  identity: true },
  { name: 'CRM',         adapter: 'crm',         row: { id: 'cl1', company_id: 'co1', email: 'c@d.com', source: 'hubspot', unified_source: { category: 'crm', origin: 'integration' }, qualification_score: 80, unified_person_id: 'up1' }, expected: 'crm', identity: true },
  { name: 'Community',   adapter: 'community',   row: { id: 'o1', organization_id: 'org1', opportunity_type: 'buying_intent', contact_id: 'c9', total_score: 0.9, status: 'new' }, expected: 'community', identity: true },
  { name: 'Engagement',  adapter: 'engagement',  row: { id: 's1', organization_id: 'org1', source_type: 'engagement', platform: 'linkedin', platform_user_id: 'u42', intent_score: 0.8 }, expected: 'engagement', identity: true },
  { name: 'MarketPulse', adapter: 'marketpulse', row: { id: 'm1', company_id: 'co1', signal_category: 'hiring', title: 'Acme hiring', summary: 'x', confidence_score: 0.6 }, expected: 'marketpulse', identity: false },
  { name: 'Active Leads',adapter: 'community',   row: { id: 'al1', organization_id: 'org1', opportunity_type: 'buying_intent', contact_id: 'c9', status: 'qualified', total_score: 0.9 }, expected: 'community', identity: true },
];

describe('Phase 3 — canonical adoption routing', () => {
  it.each(ROWS)('routes $name through the facade → source $expected', async ({ adapter, row, expected, identity }) => {
    const { ingestor, emitted, resolve } = harness();
    await adoptLeadAsync(adapter, row, ingestor);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].source).toBe(expected);
    expect(emitted[0].organizationId).toBe(row.company_id ?? row.organization_id);
    // identity reuse: the resolver port is invoked only when identity hints exist
    expect(resolve).toHaveBeenCalledTimes(identity ? 1 : 0);
    if (identity) expect(emitted[0].unifiedPersonId).toBe('fake_up');
  });

  it('preserves attribution end-to-end (nothing discarded)', async () => {
    const { ingestor, emitted } = harness();
    await adoptLeadAsync('website', { company_id: 'co1', email: 'a@b.com', utm_source: 'g', campaign: 'q3', custom_field: 'keep', deal_value: 9000 }, ingestor);
    expect(emitted[0].attribution.utm.source).toBe('g');
    expect(emitted[0].attribution.campaign).toBe('q3');
    expect(emitted[0].attribution.sourceMetadata.custom_field).toBe('keep');
    expect(emitted[0].attribution.sourceMetadata.deal_value).toBe(9000);
  });

  it('is fail-open (backward compatible): a throwing ingestor never throws to the caller', async () => {
    const throwing = { ingestFromSource: jest.fn(async () => { throw new Error('boom'); }), ingestInput: jest.fn(), ports: {} as never };
    await expect(adoptLeadAsync('website', { company_id: 'co1', email: 'a@b.com' }, throwing as never)).resolves.toBeUndefined();
    expect(throwing.ingestFromSource).toHaveBeenCalled();
  });

  it('Active Leads is a community producer/consumer (not canonical owner)', async () => {
    const { ingestor, emitted } = harness();
    await adoptLeadAsync('community', { id: 'al9', organization_id: 'org1', opportunity_type: 'migration_signal', contact_id: 'c1', status: 'reviewing' }, ingestor);
    expect(emitted[0].source).toBe('community');
    expect(emitted[0].sourceRef?.table).toBe('opportunity_feed_items');
  });
});
