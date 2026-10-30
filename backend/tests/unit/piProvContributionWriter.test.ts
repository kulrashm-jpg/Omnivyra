/**
 * Prospect provenance — contribution writer (unit, injected inserter).
 *
 * The database is modelled only by the error SHAPE the writer depends on:
 * SQLSTATE 23505 plus the violated constraint/index NAME in the message, which
 * is what PostgREST relays from PostgreSQL. The real-PostgreSQL counterpart is
 * backend/tests/realschema/pi_prov_contributions.test.ts.
 */
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: () => { throw new Error('default inserter must not be used in unit tests'); },
}));

import {
  recordSourceContribution,
  validateContributionInput,
} from '../../services/prospectProvenance/contributionWriter';
import { PROVENANCE_DB, type SourceContributionInput } from '../../../lib/prospectProvenance/contract';

type Row = Record<string, unknown>;
type Res = { data: { id: string } | null; error: { code?: string; message?: string; details?: string } | null };

const ORG = '00000000-0000-4000-8000-0000000000aa';
const LEAD = '00000000-0000-4000-8000-0000000000bb';

const base = (over: Partial<SourceContributionInput> = {}): SourceContributionInput => ({
  organizationId: ORG,
  canonicalLeadId: LEAD,
  leadCreated: true,
  sourceCategory: 'community',
  externalRef: 'community:feed-123',
  observedAt: '2026-10-30T10:00:00.000Z',
  ...over,
});

const uniq = (name: string): Res['error'] => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${name}"`,
  details: 'Key (...)=(...) already exists.',
});

/** Inserter that replays scripted results and records every row it was given. */
function scripted(...results: Res[]) {
  const rows: Row[] = [];
  const insert = jest.fn(async (row: Row): Promise<Res> => {
    rows.push(row);
    const next = results.shift();
    if (!next) throw new Error('unexpected extra insert');
    return next;
  });
  return { insert, rows };
}

describe('recordSourceContribution', () => {
  it('records an originating contribution when this ingestion created the lead', async () => {
    const { insert, rows } = scripted({ data: { id: 'c1' }, error: null });
    const res = await recordSourceContribution(
      base({ platform: 'reddit', sourceUrl: 'https://x.test/p/1', leadSignalId: 'sig-1', evidence: { excerpt_hash: 'h' } }),
      { insert },
    );
    expect(res).toEqual({ status: 'inserted', id: 'c1', role: 'originating', roleDowngraded: false });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(rows[0]).toEqual({
      organization_id: ORG,
      canonical_lead_id: LEAD,
      contribution_role: 'originating',
      source_category: 'community',
      external_ref: 'community:feed-123',
      source_record_id: null,
      platform: 'reddit',
      source_url: 'https://x.test/p/1',
      contact_id: null,
      lead_signal_id: 'sig-1',
      opportunity_feed_item_id: null,
      engagement_message_id: null,
      ingestion_run_id: null,
      observed_at: '2026-10-30T10:00:00.000Z',
      evidence: { excerpt_hash: 'h' },
      source_metadata: {},
    });
  });

  it('records a contributing contribution when the lead already existed', async () => {
    const { insert, rows } = scripted({ data: { id: 'c2' }, error: null });
    const res = await recordSourceContribution(base({ leadCreated: false }), { insert });
    expect(res).toEqual({ status: 'inserted', id: 'c2', role: 'contributing', roleDowngraded: false });
    expect(rows[0].contribution_role).toBe('contributing');
  });

  it('a retried source event (idempotency constraint) is a duplicate, not an error, and is not retried', async () => {
    const { insert } = scripted({ data: null, error: uniq(PROVENANCE_DB.idempotencyConstraint) });
    const res = await recordSourceContribution(base(), { insert });
    expect(res).toEqual({ status: 'duplicate', role: null });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('a contributing duplicate is also a duplicate', async () => {
    const { insert } = scripted({ data: null, error: uniq(PROVENANCE_DB.idempotencyConstraint) });
    expect(await recordSourceContribution(base({ leadCreated: false }), { insert }))
      .toEqual({ status: 'duplicate', role: null });
  });

  it('recognises the constraint name when PostgREST puts it only in details', async () => {
    const { insert } = scripted({
      data: null,
      error: { code: '23505', message: 'conflict', details: `constraint ${PROVENANCE_DB.idempotencyConstraint}` },
    });
    expect((await recordSourceContribution(base(), { insert })).status).toBe('duplicate');
  });

  it('an originating collision is retried as contributing with roleDowngraded', async () => {
    const { insert, rows } = scripted(
      { data: null, error: uniq(PROVENANCE_DB.oneOriginatingIndex) },
      { data: { id: 'c3' }, error: null },
    );
    const res = await recordSourceContribution(base(), { insert });
    expect(res).toEqual({ status: 'inserted', id: 'c3', role: 'contributing', roleDowngraded: true });
    expect(rows.map((r) => r.contribution_role)).toEqual(['originating', 'contributing']);
    // Everything except the role is identical between the two attempts.
    const { contribution_role: _a, ...first } = rows[0];
    const { contribution_role: _b, ...second } = rows[1];
    expect(second).toEqual(first);
  });

  it('an originating collision whose contributing retry is already recorded converges to duplicate', async () => {
    const { insert } = scripted(
      { data: null, error: uniq(PROVENANCE_DB.oneOriginatingIndex) },
      { data: null, error: uniq(PROVENANCE_DB.idempotencyConstraint) },
    );
    expect(await recordSourceContribution(base(), { insert })).toEqual({ status: 'duplicate', role: null });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('an originating-index violation on a contributing insert is NOT retried (cannot happen; reported)', async () => {
    const { insert } = scripted({ data: null, error: uniq(PROVENANCE_DB.oneOriginatingIndex) });
    const res = await recordSourceContribution(base({ leadCreated: false }), { insert });
    expect(res).toEqual({ status: 'error', code: '23505', message: expect.stringContaining(PROVENANCE_DB.oneOriginatingIndex) });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('a failing contributing retry is returned as an error', async () => {
    const { insert } = scripted(
      { data: null, error: uniq(PROVENANCE_DB.oneOriginatingIndex) },
      { data: null, error: { code: '23503', message: 'violates foreign key constraint "psc_lead_tenant_fk"' } },
    );
    expect(await recordSourceContribution(base(), { insert }))
      .toEqual({ status: 'error', code: '23503', message: 'violates foreign key constraint "psc_lead_tenant_fk"' });
  });

  it('a 23505 on an unrelated unique key is an error, not a duplicate', async () => {
    const { insert } = scripted({ data: null, error: uniq('prospect_source_contributions_pkey') });
    const res = await recordSourceContribution(base(), { insert });
    expect(res.status).toBe('error');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('a tenant-mismatch FK violation (23503) is returned, not thrown', async () => {
    const { insert } = scripted({ data: null, error: { code: '23503', message: 'violates foreign key constraint "psc_lead_tenant_fk"' } });
    await expect(recordSourceContribution(base(), { insert })).resolves
      .toEqual({ status: 'error', code: '23503', message: 'violates foreign key constraint "psc_lead_tenant_fk"' });
  });

  it('an insert that returns neither row nor error is an error', async () => {
    const { insert } = scripted({ data: null, error: null });
    expect(await recordSourceContribution(base(), { insert }))
      .toEqual({ status: 'error', code: null, message: 'insert returned no row' });
  });

  it.each([
    ['unknown category', { sourceCategory: 'twitter' as never }, /unknown sourceCategory/],
    ['un-namespaced ref', { externalRef: 'feed-123' }, /not namespaced/],
    ['upper-case provider', { externalRef: 'Community:feed-123' }, /not namespaced/],
    ['empty id after provider', { externalRef: 'community:' }, /not namespaced/],
    ['bad timestamp', { observedAt: 'yesterday' }, /observedAt/],
    ['empty timestamp', { observedAt: '' }, /observedAt/],
    ['array evidence', { evidence: [] as unknown as Record<string, unknown> }, /evidence must be a JSON object/],
    ['null evidence', { evidence: null as unknown as Record<string, unknown> }, /evidence must be a JSON object/],
    ['string metadata', { sourceMetadata: 'x' as unknown as Record<string, unknown> }, /sourceMetadata must be a JSON object/],
    ['missing organization', { organizationId: '' }, /organizationId/],
    ['missing lead', { canonicalLeadId: '' }, /canonicalLeadId/],
  ])('rejects invalid input without touching the database: %s', async (_label, over, msg) => {
    const { insert } = scripted();
    const res = await recordSourceContribution(base(over as Partial<SourceContributionInput>), { insert });
    expect(res).toEqual({ status: 'error', code: 'invalid_input', message: expect.stringMatching(msg) });
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts every contract category', () => {
    for (const c of ['marketpulse', 'social_listening', 'community', 'engagement', 'inbound_form',
      'inbound_webhook', 'manual', 'crm', 'csv', 'pi_discovery', 'pi_enrichment', 'website'] as const) {
      expect(validateContributionInput(base({ sourceCategory: c }))).toBeNull();
    }
  });
});
