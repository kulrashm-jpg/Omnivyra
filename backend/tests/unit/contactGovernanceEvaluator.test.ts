/**
 * LI-3B — contact governance evaluator contract lock.
 *
 * The failure this guards against is a person being contacted after they asked
 * not to be. So the tests assert hardest on the cases where the evaluator must
 * BLOCK, and on the three distinctions a single `is_suppressed` boolean would
 * have destroyed: bounce ≠ unsubscribe, invalid contact ≠ DNC, deferred ≠ DNC.
 */
import {
  mayContact, isGovernanceType, GOVERNANCE_TYPES, ALL_CHANNELS, KNOWN_CHANNELS,
  CONTACT_GOVERNANCE_COLUMNS, CONTACT_GOVERNANCE_VERSION,
  type GovernanceRecord, type GovernanceType,
} from '../../services/prospectIdentity/contactGovernance';

const ORG_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const NOW = '2026-06-15T12:00:00.000Z';

let seq = 0;
const rec = (over: Partial<GovernanceRecord> = {}): GovernanceRecord => ({
  id: `g-${++seq}`,
  organizationId: ORG_A,
  personId: 'p-1',
  targetNormalized: null,
  channel: 'email',
  governanceType: 'unsubscribe',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveUntil: null,
  revokedAt: null,
  ...over,
});

const ask = (records: GovernanceRecord[], over: Record<string, unknown> = {}) =>
  mayContact({ organizationId: ORG_A, personId: 'p-1', targetNormalized: null, channel: 'email', now: NOW, records, ...over });

describe('vocabulary', () => {
  it('has exactly the nine ADR types', () => {
    expect([...GOVERNANCE_TYPES]).toEqual([
      'dnc_permanent', 'dnc_channel', 'unsubscribe', 'consent_withdrawn',
      'invalid_contact', 'bounce_hard', 'complaint', 'deferred', 'campaign_exclusion']);
  });

  it('rejects anything outside it', () => {
    for (const v of GOVERNANCE_TYPES) expect(isGovernanceType(v)).toBe(true);
    for (const v of ['is_suppressed', 'dnc', 'suppressed', '', null, 7]) expect(isGovernanceType(v)).toBe(false);
  });

  it('exposes no is_suppressed boolean anywhere in the contract', () => {
    expect([...CONTACT_GOVERNANCE_COLUMNS]).not.toContain('is_suppressed');
    expect([...CONTACT_GOVERNANCE_COLUMNS]).not.toContain('suppressed');
    expect([...CONTACT_GOVERNANCE_COLUMNS]).not.toContain('scope');
  });

  it('carries no global-scope concept — D-1', () => {
    expect([...CONTACT_GOVERNANCE_COLUMNS]).not.toContain('company_id');
    expect(CONTACT_GOVERNANCE_COLUMNS).toContain('organization_id');
    expect(CONTACT_GOVERNANCE_VERSION).toMatch(/^li3b\./);
  });
});

describe('allowed when nothing applies', () => {
  it('no records', () => {
    const r = ask([]);
    expect(r.decision).toBe('allowed');
    expect(r.governanceType).toBeNull();
  });

  it('a revoked record does not block', () => {
    expect(ask([rec({ revokedAt: '2026-05-01T00:00:00.000Z' })]).decision).toBe('allowed');
  });

  it('a record for a different channel does not block', () => {
    expect(ask([rec({ channel: 'phone' })]).decision).toBe('allowed');
  });

  it('a record not yet in force does not block', () => {
    expect(ask([rec({ effectiveFrom: '2026-12-01T00:00:00.000Z' })]).decision).toBe('allowed');
  });

  it('a record for a different person does not block', () => {
    expect(ask([rec({ personId: 'p-other' })]).decision).toBe('allowed');
  });
});

describe('tenant isolation — D-1', () => {
  it('another tenant\'s record never blocks', () => {
    const r = ask([rec({ organizationId: ORG_B, governanceType: 'dnc_permanent', channel: ALL_CHANNELS })]);
    expect(r.decision).toBe('allowed');
  });

  it('the same person suppressed in tenant B is contactable in tenant A', () => {
    const bRecord = rec({ organizationId: ORG_B, governanceType: 'dnc_permanent', channel: ALL_CHANNELS });
    expect(mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: NOW, records: [bRecord] }).decision).toBe('allowed');
    expect(mayContact({ organizationId: ORG_B, personId: 'p-1', channel: 'email', now: NOW, records: [bRecord] }).decision).toBe('blocked');
  });

  it('requires a tenant — evaluation without one is never valid', () => {
    expect(() => mayContact({ organizationId: '', personId: 'p-1', channel: 'email', now: NOW, records: [] })).toThrow(/organizationId/);
  });

  it('requires a channel', () => {
    expect(() => mayContact({ organizationId: ORG_A, personId: 'p-1', channel: '', now: NOW, records: [] })).toThrow(/channel/);
  });
});

describe('channel semantics — ADR §10', () => {
  it('a `*` record blocks every channel, including unknown future ones', () => {
    const all = rec({ governanceType: 'dnc_permanent', channel: ALL_CHANNELS });
    for (const ch of [...KNOWN_CHANNELS, 'telegram', 'carrier_pigeon']) {
      expect(ask([all], { channel: ch }).decision).toBe('blocked');
    }
  });

  it('a channel-scoped record blocks only its channel', () => {
    const emailOnly = rec({ governanceType: 'dnc_channel', channel: 'email' });
    expect(ask([emailOnly], { channel: 'email' }).decision).toBe('blocked');
    expect(ask([emailOnly], { channel: 'phone' }).decision).toBe('allowed');
    expect(ask([emailOnly], { channel: 'whatsapp' }).decision).toBe('allowed');
  });
});

describe('gate order — ADR §14, bands 3-6', () => {
  it('dnc_permanent (3) wins over unsubscribe (4)', () => {
    const r = ask([
      rec({ governanceType: 'unsubscribe' }),
      rec({ governanceType: 'dnc_permanent', channel: ALL_CHANNELS }),
    ]);
    expect(r.gate).toBe(3);
    expect(r.governanceType).toBe('dnc_permanent');
  });

  it('band 4 wins over band 5', () => {
    const r = ask([rec({ governanceType: 'bounce_hard' }), rec({ governanceType: 'complaint' })]);
    expect(r.gate).toBe(4);
    expect(r.governanceType).toBe('complaint');
  });

  it('invalid_contact (5) is evaluated BEFORE deferred (6) — audit conflict 1', () => {
    const r = ask([
      rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' }),
      rec({ governanceType: 'invalid_contact' }),
    ]);
    expect(r.gate).toBe(5);
    expect(r.decision).toBe('blocked');
  });

  it('campaign_exclusion is NOT evaluated here — it is a gate-9 campaign rule', () => {
    expect(ask([rec({ governanceType: 'campaign_exclusion' })]).decision).toBe('allowed');
  });
});

describe('the distinctions a boolean would destroy', () => {
  it('bounce_hard is not unsubscribe', () => {
    const bounce = ask([rec({ governanceType: 'bounce_hard' })]);
    const unsub = ask([rec({ governanceType: 'unsubscribe' })]);
    expect(bounce.decision).toBe('blocked');
    expect(unsub.decision).toBe('blocked');
    // Both block, but the reason must survive — a corrected address resolves
    // one and never the other.
    expect(bounce.governanceType).toBe('bounce_hard');
    expect(unsub.governanceType).toBe('unsubscribe');
    expect(bounce.gate).not.toBe(unsub.gate);
  });

  it('invalid_contact is not a DNC', () => {
    const r = ask([rec({ governanceType: 'invalid_contact' })]);
    expect(r.governanceType).toBe('invalid_contact');
    expect(r.governanceType).not.toBe('dnc_permanent');
  });

  it('deferred is NOT a DNC — it returns `deferred`, not `blocked`', () => {
    const r = ask([rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' })]);
    expect(r.decision).toBe('deferred');
    expect(r.decision).not.toBe('blocked');
    expect(r.deferredUntil).toBe('2026-12-31T00:00:00.000Z');
  });
});

describe('deferment — ADR §11', () => {
  it('an active dated deferment defers', () => {
    expect(ask([rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' })]).decision).toBe('deferred');
  });

  it('an EXPIRED deferment no longer blocks', () => {
    expect(ask([rec({ governanceType: 'deferred', effectiveUntil: '2026-02-01T00:00:00.000Z' })]).decision).toBe('allowed');
  });

  it('a deferment expiring exactly now no longer blocks', () => {
    expect(ask([rec({ governanceType: 'deferred', effectiveUntil: NOW })]).decision).toBe('allowed');
  });

  it('an UNDATED deferment defers with a null lapse time — no invented default', () => {
    const r = ask([rec({ governanceType: 'deferred', effectiveUntil: null })]);
    expect(r.decision).toBe('deferred');
    expect(r.deferredUntil).toBeNull();
  });

  it('a lapsed deferment does not become a DNC', () => {
    const r = ask([rec({ governanceType: 'deferred', effectiveUntil: '2026-02-01T00:00:00.000Z' })]);
    expect(r.decision).toBe('allowed');
    expect(r.governanceType).toBeNull();
  });

  it('deferred → dnc_permanent: both records coexist and the DNC wins', () => {
    const r = ask([
      rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' }),
      rec({ governanceType: 'dnc_permanent', channel: ALL_CHANNELS }),
    ]);
    expect(r.decision).toBe('blocked');
    expect(r.governanceType).toBe('dnc_permanent');
  });
});

describe('D-3 — matching survives person deletion', () => {
  it('matches on target when person_id has been nulled', () => {
    const orphaned = rec({ personId: null, targetNormalized: 'x@y.test', governanceType: 'dnc_permanent', channel: ALL_CHANNELS });
    const r = mayContact({ organizationId: ORG_A, personId: null, targetNormalized: 'x@y.test', channel: 'email', now: NOW, records: [orphaned] });
    expect(r.decision).toBe('blocked');
    expect(r.matchedBy).toBe('target');
  });

  it('matches on person when both are present', () => {
    const r = mayContact({
      organizationId: ORG_A, personId: 'p-1', targetNormalized: 'x@y.test', channel: 'email', now: NOW,
      records: [rec({ personId: 'p-1', targetNormalized: 'x@y.test' })],
    });
    expect(r.matchedBy).toBe('person');
  });

  it('a re-imported person with the same address is still blocked', () => {
    // The person row was deleted (person_id nulled) and the lead re-imported as
    // a NEW person id. Matching on person alone would silently re-enable contact.
    const orphaned = rec({ personId: null, targetNormalized: 'x@y.test', governanceType: 'unsubscribe' });
    const r = mayContact({ organizationId: ORG_A, personId: 'p-NEW', targetNormalized: 'x@y.test', channel: 'email', now: NOW, records: [orphaned] });
    expect(r.decision).toBe('blocked');
    expect(r.matchedBy).toBe('target');
  });

  it('a record anchored to neither cannot match', () => {
    const r = mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: NOW,
      records: [rec({ personId: null, targetNormalized: null })] });
    expect(r.decision).toBe('allowed');
  });
});

describe('purity', () => {
  it('is deterministic — identical input, identical verdict', () => {
    const records = [rec({ governanceType: 'dnc_permanent', channel: ALL_CHANNELS })];
    const a = ask(records);
    const b = ask(records);
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const records = [rec({ governanceType: 'unsubscribe' }), rec({ governanceType: 'deferred', effectiveUntil: '2026-12-31T00:00:00.000Z' })];
    const snapshot = JSON.parse(JSON.stringify(records));
    ask(records);
    expect(records).toEqual(snapshot);
  });

  it('reads no clock — `now` is injected and changes the verdict', () => {
    const deferment = [rec({ governanceType: 'deferred', effectiveUntil: '2026-07-01T00:00:00.000Z' })];
    expect(mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: '2026-06-15T12:00:00.000Z', records: deferment }).decision).toBe('deferred');
    expect(mayContact({ organizationId: ORG_A, personId: 'p-1', channel: 'email', now: '2026-08-15T12:00:00.000Z', records: deferment }).decision).toBe('allowed');
  });

  it('performs no I/O — the module imports nothing that can', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/prospectIdentity/contactGovernance.ts'), 'utf8');
    for (const forbidden of [/ownedDbTable/, /supabase/, /\.insert\(/, /\.update\(/, /\.from\(/, /fetch\(/, /Date\.now\(/, /new Date\(\)/]) {
      expect(src).not.toMatch(forbidden);
    }
  });
});
