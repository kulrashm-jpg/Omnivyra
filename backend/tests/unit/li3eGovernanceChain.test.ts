/**
 * LI-3E — the governance chain, end to end.
 *
 * LI-3B tested the evaluator, LI-3D tested the writer, and LI-3C tested the
 * Path B gate — each against its own test double. The seam nothing tested is
 * the one that matters most for release: that a row the WRITER produces is a
 * row the REPOSITORY can find and the EVALUATOR can decide on. A column-name
 * drift or a normalisation mismatch between writer and reader would leave both
 * sides green and governance silently unenforced.
 *
 * So this suite runs the real writer, the real repository, the real evaluator
 * and the real Path B gate against ONE shared in-memory table, and asserts the
 * decision that comes out the far end.
 *
 * It creates no production row, calls no provider and activates no channel.
 */

type Row = Record<string, unknown>;

/**
 * Stands in for the schema's `effective_from DEFAULT now()`. Records are written
 * before they are evaluated, so the default must precede the evaluation instant.
 */
const WRITTEN_AT = '2026-01-01T00:00:00.000Z';

/** The single shared table every layer in this test reads and writes. */
let table: Row[] = [];
let nextId = 1;
let failReads = false;

/** Minimal PostgREST-shaped double with the partial-unique index enforced. */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (name: string) => {
    const filters: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    const matches = (r: Row) =>
      filters.every(([c, v]) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)) &&
      ins.every(([c, vs]) => vs.includes(r[c] as never));

    builder.select = () => chain();
    builder.limit = () => chain();
    builder.eq = (c: string, v: unknown) => { filters.push([c, v]); return chain(); };
    builder.is = (c: string, v: unknown) => { filters.push([c, v]); return chain(); };
    builder.in = (c: string, vs: unknown[]) => { ins.push([c, vs]); return chain(); };

    builder.insert = (row: Row) => ({
      select: () => ({
        single: async () => {
          if (name !== 'contact_governance_records') return { data: { id: 'x' }, error: null };
          // Enforce uq_contact_governance_identity, including its partial predicate.
          const anchor = (r: Row) => (r.person_id ?? r.target_normalized);
          const clash = table.some((r) =>
            r.revoked_at == null &&
            r.organization_id === row.organization_id &&
            r.channel === row.channel &&
            r.governance_type === row.governance_type &&
            anchor(r) === anchor(row));
          if (clash) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          // `effective_from` is NOT NULL DEFAULT now() in the real schema; the
          // writer only sends it when the caller specified one. The default is a
          // fixed EARLY instant rather than the wall clock, because these tests
          // evaluate at a fixed NOW — stamping the real clock would make every
          // record read as not-yet-in-force and hide real matching failures.
          const created = {
            id: `g${nextId++}`,
            revoked_at: null,
            effective_until: null,
            effective_from: WRITTEN_AT,
            ...row,
          };
          table.push(created);
          return { data: { id: created.id }, error: null };
        },
      }),
    });

    builder.update = (patch: Row) => {
      const u: Record<string, unknown> = {};
      const uf: Array<[string, unknown]> = [];
      u.eq = (c: string, v: unknown) => { uf.push([c, v]); return u; };
      u.is = (c: string, v: unknown) => { uf.push([c, v]); return u; };
      u.select = async () => {
        const hit = table.filter((r) =>
          uf.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)));
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      };
      return u;
    };

    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (failReads) return resolve({ error: { message: 'read failure' } });
      if (name === 'leads') {
        return resolve({ data: leads.filter(matches), error: null });
      }
      return resolve({ data: table.filter(matches), error: null });
    };
    return builder;
  },
}));

let leads: Row[] = [];

import { recordContactGovernance, revokeContactGovernance } from '../../services/prospectIdentity/contactGovernanceWriter';
import { loadGovernanceRecords } from '../../services/prospectIdentity/contactGovernanceRepository';
import { mayContact } from '../../services/prospectIdentity/contactGovernance';
import { evaluateSuppression, type GovernanceEvaluationInput, type CanonicalGovernanceVerdict } from '../../services/leadOutreachExecution/governance';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PERSON_A = 'person-a';
const NOW = '2026-08-14T12:00:00.000Z';

beforeEach(() => {
  table = [];
  nextId = 1;
  failReads = false;
  leads = [{ id: 'lead-1', company_id: ORG_A, unified_person_id: PERSON_A }];
});

/** The full read path: repository -> evaluator -> Path B suppression gate. */
async function decide(opts: {
  org: string; channel: string; target?: string | null; personId?: string | null;
  now?: string; legacyRecipient?: boolean;
}) {
  const loaded = await loadGovernanceRecords({
    organizationId: opts.org,
    personId: opts.personId ?? null,
    target: opts.target ?? null,
    channel: opts.channel as never,
  });
  const verdict = loaded.ok
    ? mayContact({
        organizationId: opts.org,
        personId: opts.personId ?? null,
        targetNormalized: opts.target ? String(opts.target).trim().toLowerCase() : null,
        channel: opts.channel as never,
        now: opts.now ?? NOW,
        records: loaded.records,
      })
    : { decision: 'blocked', gate: null, governanceType: null, recordId: null, matchedBy: null,
        reason: 'governance_lookup_failed_failclosed', deferredUntil: null, version: 'li3c' };

  return evaluateSuppression({
    task: { channel: opts.channel },
    config: { enabledChannels: [opts.channel] },
    suppressions: { task: false, lead: false, channel: false, recipient: opts.legacyRecipient ?? false },
    canonicalGovernance: verdict as unknown as CanonicalGovernanceVerdict,
  } as unknown as GovernanceEvaluationInput);
}

describe('LI-3E — a written record is a readable, enforceable record', () => {
  it('target-anchored: writer -> repository -> evaluator -> Path B BLOCK', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'Reader@Example.COM', source: 'webhook:ses',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'reader@example.com' });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.unsubscribe');
  });

  it('the writer and reader agree on normalisation — mixed case and spacing still match', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: '  MiXeD@Example.COM  ', source: 'manual',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'mixed@example.com' });
    expect(g.decision).toBe('blocked');
  });

  it('person-anchored: writer -> repository -> evaluator -> Path B BLOCK', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'anything@example.com', personId: PERSON_A });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.dnc_permanent');
  });

  it('person + target anchored: matches on either anchor alone', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, target: 'both@example.com', source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'email', personId: PERSON_A })).decision).toBe('blocked');
    expect((await decide({ org: ORG_A, channel: 'email', target: 'both@example.com' })).decision).toBe('blocked');
  });

  it('a phone DNC written on one channel does not block email', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_channel', channel: 'phone',
      target: '+1 (555) 010-9999', source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'p@example.com' })).decision).toBe('allowed');
  });
});

describe('LI-3E — tenant isolation across the whole chain', () => {
  it('Tenant A governance never reaches Tenant B, same email', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'shared@example.com', source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'shared@example.com' })).decision).toBe('blocked');
    expect((await decide({ org: ORG_B, channel: 'email', target: 'shared@example.com' })).decision).toBe('allowed');
  });

  it('same phone across two tenants stays independent', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_channel', channel: 'phone',
      target: '+15550100000', source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'phone', target: '+15550100000' })).decision).toBe('blocked');
    expect((await decide({ org: ORG_B, channel: 'phone', target: '+15550100000' })).decision).toBe('allowed');
  });

  it('the same person id governed in A is contactable in B', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'email', personId: PERSON_A })).decision).toBe('blocked');
    expect((await decide({ org: ORG_B, channel: 'email', personId: PERSON_A })).decision).toBe('allowed');
  });

  it('Tenant B cannot revoke a Tenant A record', async () => {
    const r = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'norevoke@example.com', source: 'manual',
    });
    expect(await revokeContactGovernance({ organizationId: ORG_B, id: r.id, reason: 'attempted' }))
      .toEqual({ revoked: false });
    // Still enforced for its own tenant.
    expect((await decide({ org: ORG_A, channel: 'email', target: 'norevoke@example.com' })).decision).toBe('blocked');
  });
});

describe('LI-3E — idempotency and revocation through the chain', () => {
  it('a duplicate instruction is a no-op and leaves exactly one live record', async () => {
    const a = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'dup@example.com', source: 'webhook:ses',
    });
    const b = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'dup@example.com', source: 'webhook:ses',
    });
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('already_present');
    expect(b.id).toBe(a.id);
    expect(table.filter((r) => r.revoked_at == null)).toHaveLength(1);
  });

  it('revoking stops enforcement and frees the key for a fresh record', async () => {
    const first = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'cycle@example.com', source: 'manual',
    });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'cycle@example.com' })).decision).toBe('blocked');

    await revokeContactGovernance({ organizationId: ORG_A, id: first.id, reason: 'resubscribed' });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'cycle@example.com' })).decision).toBe('allowed');

    const second = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'cycle@example.com', source: 'manual',
    });
    expect(second.outcome).toBe('created');
    expect(second.id).not.toBe(first.id);
    expect((await decide({ org: ORG_A, channel: 'email', target: 'cycle@example.com' })).decision).toBe('blocked');
  });

  it('revocation preserves the original row rather than deleting it', async () => {
    const r = await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'keep@example.com', source: 'webhook:ses',
    });
    await revokeContactGovernance({ organizationId: ORG_A, id: r.id, reason: 'operator error' });
    const row = table.find((x) => x.id === r.id)!;
    expect(row).toBeDefined();                              // not deleted
    expect(row.organization_id).toBe(ORG_A);                // tenant intact
    expect(row.target_normalized).toBe('keep@example.com'); // target intact
    expect(row.source).toBe('webhook:ses');                 // provenance intact
    expect(row.revoked_reason).toBe('operator error');
  });
});

describe('LI-3E — temporal semantics through the chain', () => {
  it('a record not yet in force does not block', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'future@example.com', source: 'manual',
      effectiveFrom: '2027-01-01T00:00:00.000Z',
    });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'future@example.com' })).decision).toBe('allowed');
    expect((await decide({ org: ORG_A, channel: 'email', target: 'future@example.com', now: '2027-02-01T00:00:00.000Z' })).decision).toBe('blocked');
  });

  it('an active dated deferment defers and carries its lapse time', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'deferred', channel: 'email',
      target: 'later@example.com', source: 'manual',
      effectiveUntil: '2026-12-01T00:00:00.000Z',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'later@example.com' });
    expect(g.decision).toBe('deferred');
    expect((g.evidence as Record<string, unknown>).deferredUntil).toBe('2026-12-01T00:00:00.000Z');
  });

  it('an expired deferment no longer blocks, and never becomes a DNC', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'deferred', channel: 'email',
      target: 'lapsed@example.com', source: 'manual',
      effectiveUntil: '2026-08-01T00:00:00.000Z',
    });
    expect((await decide({ org: ORG_A, channel: 'email', target: 'lapsed@example.com' })).decision).toBe('allowed');
  });

  it('an undated deferment keeps deferring, with no invented end date', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'deferred', channel: 'email',
      target: 'undated@example.com', source: 'manual',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'undated@example.com' });
    expect(g.decision).toBe('deferred');
    expect((g.evidence as Record<string, unknown>).deferredUntil).toBeNull();
  });

  it('a DNC outranks a deferment on the same person', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'deferred', channel: '*',
      personId: PERSON_A, source: 'manual', effectiveUntil: '2026-12-01T00:00:00.000Z',
    });
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'dnc_permanent', channel: '*',
      personId: PERSON_A, source: 'manual',
    });
    const g = await decide({ org: ORG_A, channel: 'email', personId: PERSON_A });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.dnc_permanent');
  });
});

describe('LI-3E — canonical-first and fail-closed survive the whole chain', () => {
  it('a canonical block cannot be overridden by a legacy allow', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'complaint', channel: 'email',
      target: 'canon@example.com', source: 'webhook:ses',
    });
    const g = await decide({ org: ORG_A, channel: 'email', target: 'canon@example.com', legacyRecipient: false });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('governance.complaint');
  });

  it('legacy suppression still applies when canonical allows', async () => {
    const g = await decide({ org: ORG_A, channel: 'email', target: 'legacy@example.com', legacyRecipient: true });
    expect(g.decision).toBe('blocked');
    expect(g.rule).toBe('suppression.recipient');
  });

  it('an unreadable governance table blocks, never falls back to legacy-only', async () => {
    failReads = true;
    const g = await decide({ org: ORG_A, channel: 'email', target: 'unreadable@example.com', legacyRecipient: false });
    expect(g.decision).toBe('blocked');
    expect(g.reason).toBe('governance_lookup_failed_failclosed');
  });
});

describe('LI-3E — evaluation is free and inert', () => {
  it('the whole chain touches no billing, quota, provider or transport module', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      '../../services/prospectIdentity/contactGovernance.ts',
      '../../services/prospectIdentity/contactGovernanceRepository.ts',
      '../../services/prospectIdentity/contactGovernanceWriter.ts',
      '../../services/leadOutreachExecution/governance.ts',
    ];
    const forbidden = /from ['"].*(credit|billing|payment|quota|stripe|sendgrid|twilio|whatsapp|nodemailer|resend|smtp|provider|transport)/i;
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      const imports = src.split('\n').filter((l: string) => l.trim().startsWith('import'));
      for (const line of imports) expect(line).not.toMatch(forbidden);
    }
  });

  it('evaluating repeatedly creates no rows and mutates nothing', async () => {
    await recordContactGovernance({
      organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email',
      target: 'inert@example.com', source: 'manual',
    });
    const before = JSON.stringify(table);
    for (let i = 0; i < 5; i += 1) {
      await decide({ org: ORG_A, channel: 'email', target: 'inert@example.com' });
    }
    expect(JSON.stringify(table)).toBe(before);   // evaluation consumed nothing
    expect(table).toHaveLength(1);
  });
});
