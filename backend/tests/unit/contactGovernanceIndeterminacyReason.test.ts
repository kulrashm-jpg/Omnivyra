/**
 * indeterminacyReason: the per-read indeterminacy rules, exported as the single source of truth so
 * a caller that needs the governance TYPES in force (Orchestration's personRestrictions) applies the
 * same rules as evaluateGovernanceReads instead of a copy (MIG-2R item 4, 2026-11-11).
 */
import { indeterminacyReason } from '../../services/prospectIdentity/contactGovernanceAggregation';

const rec = { id: 'g1', organizationId: 'o', personId: 'p', targetNormalized: null, channel: 'email',
  governanceType: 'unsubscribe', effectiveFrom: '2026-01-01T00:00:00+00:00', effectiveUntil: null, revokedAt: null } as never;

describe('indeterminacyReason', () => {
  it('a failed read is indeterminate, with its error', () => {
    expect(indeterminacyReason({ anchor: 'person', ok: false, records: [], readAt: null, error: 'boom' })).toBe('person: boom');
    expect(indeterminacyReason({ anchor: 'target', ok: false, records: [], readAt: null })).toBe('target: read failed');
  });
  it('rows without a database read instant are indeterminate', () => {
    expect(indeterminacyReason({ anchor: 'tenant', ok: true, records: [rec], readAt: null }))
      .toBe('tenant: 1 governance record(s) arrived without a database read instant');
  });
  it('an empty successful read is judgeable (neutral), with or without an instant', () => {
    expect(indeterminacyReason({ anchor: 'person', ok: true, records: [], readAt: null })).toBeNull();
    expect(indeterminacyReason({ anchor: 'person', ok: true, records: [], readAt: '2026-11-11T00:00:00+00:00' })).toBeNull();
  });
  it('rows with an instant are judgeable', () => {
    expect(indeterminacyReason({ anchor: 'person', ok: true, records: [rec], readAt: '2026-11-11T00:00:00+00:00' })).toBeNull();
  });
});
