/**
 * Identity verification contract (verificationContract.ts), the operator
 * attestation store + route, the tightened community person proof, and the
 * 20261231000007 migration.
 *
 * The invariant under test above all others: OPERATOR ATTESTATION NEVER
 * VERIFIES. Recording one writes no identity claim, and a claim marked verified
 * on attestation evidence is refused by the proof at link AND execution time.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));

// ── a fake database: records every table touched ────────────────────────────

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const touched: Array<{ table: string; op: string }> = [];
const tick = () => new Promise<void>((r) => setImmediate(r));
let seq = 0;

function fakeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let insertRow: Row | null = null;
  let patch: Row | null = null;
  const run = async (mode: 'one' | 'many') => {
    await tick();
    const rows = (tables[table] ??= []);
    if (insertRow !== null) {
      touched.push({ table, op: 'insert' });
      const row = insertRow;
      if (table === 'identity_verification_attestations' && row.status === 'recorded'
          && rows.some((r) => r.status === 'recorded' && r.organization_id === row.organization_id
            && r.platform === row.platform && r.provider_user_id === row.provider_user_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_identity_verification_attestations_active_account"' } };
      }
      const stored = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, attested_at: '2026-10-28T09:00:00.000Z', created_at: '2026-10-28T09:00:00.000Z', withdrawn_at: null, withdrawn_by: null, withdrawn_reason: null, ...row };
      rows.push(stored);
      return { data: { ...stored }, error: null };
    }
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    if (patch !== null) {
      touched.push({ table, op: 'update' });
      for (const r of matched) Object.assign(r, patch);
      return { data: matched[0] ? { ...matched[0] } : null, error: null };
    }
    touched.push({ table, op: 'select' });
    if (mode === 'many') return { data: matched.map((r) => ({ ...r })), error: null };
    return { data: matched[0] ? { ...matched[0] } : null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    order: () => b,
    limit: () => b,
    insert: (row: Row) => { insertRow = row; return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => run('one'),
    single: () => run('one'),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run('many').then(res, rej),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeQuery(t), ownedDbRpc: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeQuery(t), rpc: jest.fn() } }));

// ── authorization seams ─────────────────────────────────────────────────────

const OPERATOR = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const auth = { member: true, capability: true };
const authCalls: Array<{ step: string; opts?: Record<string, unknown> }> = [];
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res }: { res: { status: (c: number) => { json: (b: unknown) => void } } }) => {
    authCalls.push({ step: 'access' });
    if (!auth.member) { res.status(403).json({ error: 'forbidden' }); return null; }
    return { userId: OPERATOR };
  }),
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, opts: Record<string, unknown>) => {
    authCalls.push({ step: 'capability', opts });
    if (!auth.capability) { res.status(403).json({ error: 'capability' }); return { ok: false, sent: true }; }
    return { ok: true, principal: { userId: OPERATOR, stepUp: { active: true, sessionId: 'su-1', factor: 'webauthn', expiresAt: null } } };
  }),
}));

import handler, { ATTESTATION_STEP_UP, statusForAttestationError } from '../../../pages/api/identity-verification/attestations';
import {
  ACCEPTED_PROOF_METHODS, MAX_PROOF_AGE_DAYS, NON_PROVING_METHODS, OPERATOR_CONFIRMATION_REQUIREMENTS,
  evaluateClaimEvidence, operatorAttestationConfersVerification,
} from '../../services/identityVerification/verificationContract';
import {
  ATTESTATIONS_TABLE, AttestationError, recordAttestation, sanitizeAttestationEvidence, toAttestation, withdrawAttestation,
  type AttestationRow,
} from '../../services/identityVerification/attestationStore';
import { proveActionPerson, type ProofActionRow } from '../../services/orchestration/communityIdentityProof';
import { linkCommunityAction, type CommunityJourneyLink, type LinkStoreDeps } from '../../services/orchestration/communityJourneyLinkStore';
import { createLinkedActionBinding, type CommunityActionRow } from '../../services/orchestration/communityEngineAdapter';
import type { ExecutionTask } from '../../services/executionPlans/executionPlanStore';
import { CONTRACT_ORG, CONTRACT_OTHER_ORG, contractContext } from './helpers/engineAdapterContractKit';
import {
  DISCOVERED_USER, OTHER_PERSON, PROVEN_PERSON, PROVIDER_ID, SUBJECT, VERIFIED_CLAIM, identityWorld, subjectOAuthEvidence,
} from './helpers/communityIdentityFixture';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const NOW = new Date('2026-10-28T09:00:00.000Z');
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE = contractContext().executionInstanceId;
const TASK = contractContext().executionTaskId;
const PID = PROVIDER_ID.toLowerCase();

function actionRow(over: Partial<CommunityActionRow> = {}): CommunityActionRow {
  return {
    id: ACTION, tenant_id: CONTRACT_ORG, organization_id: CONTRACT_ORG,
    platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:activity:123',
    suggested_text: 'Thanks for sharing this.', final_text: null, playbook_id: 'pb-1',
    requires_human_approval: true, risk_level: 'low', approved_at: null, status: 'pending',
    execution_mode: 'api', scheduled_at: null, execution_correlation_id: null,
    execution_result: null, intent_classification: null, discovered_user_id: DISCOVERED_USER, ...over,
  };
}

const claimFor = (evidence: unknown, over: Record<string, unknown> = {}) => ({
  organization_id: CONTRACT_ORG, person_id: PROVEN_PERSON, platform: 'linkedin', normalized_value: PID, evidence, ...over,
});
const ev = (over: Record<string, unknown> = {}) => ({ ...subjectOAuthEvidence(CONTRACT_ORG, PROVEN_PERSON, PROVIDER_ID, '2026-10-27T09:00:00.000Z'), ...over });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  touched.length = 0;
  authCalls.length = 0;
  Object.assign(auth, { member: true, capability: true });
});

// ── 1. The contract ─────────────────────────────────────────────────────────

describe('verification contract', () => {
  it('accepts exactly one person-level method, never an operator one', () => {
    expect([...ACCEPTED_PROOF_METHODS]).toEqual(['subject_platform_oauth']);
    for (const m of ACCEPTED_PROOF_METHODS) expect(NON_PROVING_METHODS as readonly string[]).not.toContain(m);
    expect(NON_PROVING_METHODS).toContain('operator_attestation');
    expect(NON_PROVING_METHODS).toContain('operator_confirmation');
    expect(operatorAttestationConfersVerification()).toBe(false);
  });

  it('a consistent, current subject OAuth proof is accepted', () => {
    expect(evaluateClaimEvidence(claimFor(ev()), NOW)).toEqual({ ok: true, method: 'subject_platform_oauth' });
  });

  it.each([
    ['no evidence', undefined, 'evidence_missing'],
    ['empty evidence', {}, 'evidence_missing'],
    ['array evidence', [], 'evidence_missing'],
    ['operator attestation', { method: 'operator_attestation', organization_id: CONTRACT_ORG, subject_person_id: PROVEN_PERSON }, 'method_non_proving'],
    ['operator attestation with every proof field', null, 'method_non_proving'],
    ['operator confirmation', { method: 'operator_confirmation' }, 'method_non_proving'],
    ['unknown method', { method: 'magic' }, 'method_unsupported'],
  ])('refuses %s', (_l, evidence, reason) => {
    const e = evidence === null ? ev({ method: 'operator_attestation' }) : evidence;
    expect(evaluateClaimEvidence(claimFor(e), NOW)).toEqual({ ok: false, reason });
  });

  it.each([
    ['tenant', { organization_id: CONTRACT_OTHER_ORG }, 'tenant_mismatch'],
    ['person (reassigned claim)', { subject_person_id: OTHER_PERSON }, 'person_mismatch'],
    ['provider', { provider: 'x' }, 'provider_mismatch'],
    ['provider user id', { provider_user_id: 'someone-else' }, 'provider_user_id_mismatch'],
    ['flow', { flow_id: '  ' }, 'flow_missing'],
    ['timestamp', { completed_at: 'yesterday' }, 'timestamp_invalid'],
    ['future timestamp', { completed_at: '2026-10-28T10:00:00.000Z' }, 'timestamp_future'],
    ['stale proof', { completed_at: new Date(NOW.getTime() - (MAX_PROOF_AGE_DAYS + 1) * 86400000).toISOString() }, 'proof_stale'],
  ])('refuses evidence inconsistent on %s', (_l, over, reason) => {
    expect(evaluateClaimEvidence(claimFor(ev(over)), NOW)).toEqual({ ok: false, reason });
  });

  it('the future operator-confirmation contract demands platform-observed proof, four eyes and an owner decision', () => {
    const ids = OPERATOR_CONFIRMATION_REQUIREMENTS.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([
      'platform_challenge', 'platform_observation', 'raw_response_digest', 'subject_and_tenant',
      'operator_identity_step_up', 'second_approver', 'lawful_basis', 'revocation_and_expiry', 'owner_decision',
    ]));
  });
});

// ── 2. The proof, end to end over the identity fakes ────────────────────────

describe('community person proof with the evidence contract', () => {
  const prove = (w: ReturnType<typeof identityWorld>, opts: { expected?: Array<string | null>; now?: Date; action?: Partial<ProofActionRow> } = {}) =>
    proveActionPerson({
      organizationId: CONTRACT_ORG, subject: SUBJECT,
      action: actionRow(opts.action as Partial<CommunityActionRow>), expectedPersonIds: opts.expected ?? [], now: opts.now,
    }, w.port);
  const codeOf = async (p: ReturnType<typeof prove>) => { const r = await p; return r.ok === false ? r.code : 'ok'; };

  it('valid proof: a verified claim carrying a subject OAuth proof', async () => {
    const r = await prove(identityWorld());
    expect(r).toEqual({ ok: true, personId: PROVEN_PERSON, claimId: VERIFIED_CLAIM, discoveredUserId: DISCOVERED_USER, platform: 'linkedin', providerId: PID });
  });

  it('missing proof: no claim at all', async () => {
    const w = identityWorld();
    w.claims.length = 0;
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
  });

  it('invalid proof: attestation-only, unverified, rejected, no evidence', async () => {
    const att = identityWorld();
    att.claims[0].evidence = ev({ method: 'operator_attestation' });
    expect(await codeOf(prove(att))).toBe('identity_evidence_insufficient');
    const bare = identityWorld();
    delete bare.claims[0].evidence;
    expect(await codeOf(prove(bare))).toBe('identity_evidence_insufficient');
    const unv = identityWorld();
    Object.assign(unv.claims[0], { verification_state: 'unverified', verified_at: null, evidence: ev() });
    expect(await codeOf(prove(unv))).toBe('identity_unverified');
    const rej = identityWorld();
    Object.assign(rej.claims[0], { verification_state: 'rejected', verified_at: null });
    expect(await codeOf(prove(rej))).toBe('identity_unverified');
  });

  it('revocation: a revoked claim proves nothing', async () => {
    const w = identityWorld();
    w.claims[0].revoked_at = '2026-10-27T00:00:00.000Z';
    expect(await codeOf(prove(w))).toBe('identity_unclaimed');
  });

  it('account reassignment: the claim moved to the run person without new proof, or to another person', async () => {
    const OTHER_SUBJECT_PERSON = OTHER_PERSON;
    // The claim was verified for OTHER_PERSON, then re-pointed at the run's person.
    const moved = identityWorld();
    moved.claims[0].evidence = subjectOAuthEvidence(CONTRACT_ORG, OTHER_SUBJECT_PERSON);
    expect(await codeOf(prove(moved))).toBe('identity_evidence_insufficient');
    // The claim now belongs to another person.
    const other = identityWorld();
    Object.assign(other.claims[0], { person_id: OTHER_PERSON, evidence: subjectOAuthEvidence(CONTRACT_ORG, OTHER_PERSON) });
    expect(await codeOf(prove(other))).toBe('identity_mismatch');
  });

  it('person mismatch: a recorded person differs from the run person', async () => {
    expect(await codeOf(prove(identityWorld(), { expected: [OTHER_PERSON] }))).toBe('person_mismatch');
  });

  it('tenant mismatch: the action, or the proof, is another tenant\'s', async () => {
    expect(await codeOf(prove(identityWorld(), { action: { organization_id: CONTRACT_OTHER_ORG } }))).toBe('identity_cross_tenant');
    const copied = identityWorld();
    copied.claims[0].evidence = subjectOAuthEvidence(CONTRACT_OTHER_ORG);
    expect(await codeOf(prove(copied))).toBe('identity_evidence_insufficient');
    // The claim row itself in another tenant is never read.
    const foreign = identityWorld();
    foreign.claims[0].organization_id = CONTRACT_OTHER_ORG;
    expect(await codeOf(prove(foreign))).toBe('identity_unclaimed');
  });

  it('ambiguous: a second active claim for the account', async () => {
    const w = identityWorld();
    w.claims.push({ ...w.claims[0], id: 'c2' });
    expect(await codeOf(prove(w))).toBe('identity_ambiguous');
  });

  it('stale: a proof that was valid at link time is refused once it ages out', async () => {
    const w = identityWorld();
    w.claims[0].evidence = subjectOAuthEvidence(CONTRACT_ORG, PROVEN_PERSON, PROVIDER_ID, '2026-10-01T00:00:00.000Z');
    expect(await codeOf(prove(w, { now: NOW }))).toBe('ok');
    const later = new Date(Date.parse('2026-10-01T00:00:00.000Z') + (MAX_PROOF_AGE_DAYS + 1) * 86400000);
    expect(await codeOf(prove(w, { now: later }))).toBe('identity_evidence_insufficient');
  });
});

// ── 3. Link and execution ───────────────────────────────────────────────────

function linkWorld() {
  const idw = identityWorld();
  const links: CommunityJourneyLink[] = [];
  const t: ExecutionTask = {
    id: TASK, organizationId: CONTRACT_ORG, executionInstanceId: INSTANCE, planStepId: contractContext().planStepId,
    subjectKind: SUBJECT.kind as ExecutionTask['subjectKind'], subjectId: SUBJECT.id, channel: 'community', action: null,
    delayAfterPreviousHours: 0, requiresApproval: true, state: 'prepared', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  } as ExecutionTask;
  const deps: LinkStoreDeps = {
    async readLinkByTask(o, id) { await tick(); return links.find((l) => l.organizationId === o && l.executionTaskId === id) ?? null; },
    async listLinksByInstance(o, id) { return links.filter((l) => l.organizationId === o && l.executionInstanceId === id); },
    async readTask(o, id) { await tick(); return o === CONTRACT_ORG && id === TASK ? t : null; },
    async readAction(o, id) { await tick(); return o === CONTRACT_ORG && id === ACTION ? actionRow() : null; },
    async insertLink(row) {
      await tick();
      if (links.some((l) => l.organizationId === row.organization_id && l.executionTaskId === row.execution_task_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "community_action_journey_links_task_unique"' } };
      }
      const link: CommunityJourneyLink = {
        id: `link-${links.length + 1}`, organizationId: row.organization_id, executionTaskId: row.execution_task_id,
        executionInstanceId: row.execution_instance_id, communityActionId: row.community_action_id,
        personId: row.person_id, identityClaimId: row.identity_claim_id, linkedBy: row.linked_by, createdAt: NOW.toISOString(),
      } as CommunityJourneyLink;
      links.push(link);
      return { data: link, error: null };
    },
    identity: idw.port,
  };
  const link = () => linkCommunityAction({ organizationId: CONTRACT_ORG, executionInstanceId: INSTANCE, executionTaskId: TASK, communityActionId: ACTION, linkedBy: OPERATOR }, deps);
  return { idw, links, deps, link };
}
const codeOfLink = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? 'thrown'; } };

describe('link and execution use the same proof', () => {
  it('an attestation-only verified claim cannot be linked', async () => {
    const w = linkWorld();
    w.idw.claims[0].evidence = ev({ method: 'operator_attestation' });
    expect(await codeOfLink(w.link())).toBe('identity_evidence_insufficient');
    expect(w.links).toHaveLength(0);
  });

  it('concurrent link attempts with a valid proof produce one link; all callers see it', async () => {
    const w = linkWorld();
    const results = await Promise.all(Array.from({ length: 5 }, () => w.link()));
    expect(w.links).toHaveLength(1);
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.link.id)).size).toBe(1);
  });

  it('concurrent link attempts without a valid proof all fail and write nothing', async () => {
    const w = linkWorld();
    w.idw.claims[0].evidence = ev({ method: 'operator_attestation' });
    const codes = await Promise.all(Array.from({ length: 5 }, () => codeOfLink(w.link())));
    expect(new Set(codes)).toEqual(new Set(['identity_evidence_insufficient']));
    expect(w.links).toHaveLength(0);
  });

  it('execution re-proves: revocation or downgrade to attestation after linking stops the step', async () => {
    const w = linkWorld();
    await w.link();
    const binding = createLinkedActionBinding(async () => ({ actionId: ACTION, personId: PROVEN_PERSON }), w.idw.port);
    const ctx = { ...contractContext(), organizationId: CONTRACT_ORG, personId: PROVEN_PERSON };
    const bound = await binding.resolve(ctx as never);
    if (bound.kind !== 'bound' || !bound.identity) throw new Error('expected a bound binding');
    expect((await bound.identity(actionRow())).ok).toBe(true);
    w.idw.claims[0].evidence = ev({ method: 'operator_attestation' });
    const r1 = await bound.identity(actionRow());
    expect(r1.ok === false ? r1.code : 'ok').toBe('identity_evidence_insufficient');
    w.idw.claims[0].evidence = ev();
    w.idw.claims[0].revoked_at = '2026-10-28T00:00:00.000Z';
    const r2 = await bound.identity(actionRow());
    expect(r2.ok === false ? r2.code : 'ok').toBe('identity_unclaimed');
  });
});

// ── 4. The attestation store ────────────────────────────────────────────────

const recordInput = (over: Record<string, unknown> = {}) => ({
  organizationId: CONTRACT_ORG, personId: PROVEN_PERSON, platform: 'LinkedIn', providerUserId: PROVIDER_ID,
  basis: 'public_profile_review', statement: 'Profile matches name, employer and city from the CRM.',
  evidence: { references: ['https://www.linkedin.com/in/jane-doe'], notes: 'checked manually' },
  attestedBy: OPERATOR, stepUpSessionId: 'su-1', stepUpFactor: 'webauthn', ...over,
});

describe('operator attestation store', () => {
  it('records operator, method, basis, evidence, subject, account and step-up — and confers no verification', async () => {
    const { attestation, replayed } = await recordAttestation(recordInput());
    expect(replayed).toBe(false);
    expect(attestation).toMatchObject({
      organizationId: CONTRACT_ORG, personId: PROVEN_PERSON, platform: 'linkedin', providerUserId: PID,
      method: 'operator_attestation', basis: 'public_profile_review', attestedBy: OPERATOR,
      stepUpSessionId: 'su-1', stepUpFactor: 'webauthn', status: 'recorded', confersVerification: false,
    });
    const stored = tables[ATTESTATIONS_TABLE][0];
    expect(stored.confers_verification).toBe(false);
    expect(stored).not.toHaveProperty('verification_state');
  });

  it('ATTESTATION NEVER VERIFIES: no identity_claims access, and the proof still refuses afterwards', async () => {
    await recordAttestation(recordInput());
    expect(touched.every((t) => t.table === ATTESTATIONS_TABLE)).toBe(true);
    expect(touched.length).toBeGreaterThan(0);
    // An attributed, unverified claim stays unverified.
    const w = identityWorld();
    Object.assign(w.claims[0], { verification_state: 'unverified', verified_at: null, evidence: {} });
    const r = await proveActionPerson({ organizationId: CONTRACT_ORG, subject: SUBJECT, action: actionRow() }, w.port);
    expect(r.ok === false ? r.code : 'ok').toBe('identity_unverified');
  });

  it('confersVerification is the constant false even if a row says otherwise', () => {
    const row = { ...tables[ATTESTATIONS_TABLE]?.[0], confers_verification: true } as unknown as AttestationRow;
    expect(toAttestation(row).confersVerification).toBe(false);
  });

  it('refuses evidence keys that try to look like a proof', () => {
    expect(() => sanitizeAttestationEvidence({ method: 'subject_platform_oauth' })).toThrow(AttestationError);
    expect(() => sanitizeAttestationEvidence({ verification_state: 'verified' })).toThrow(AttestationError);
    expect(() => sanitizeAttestationEvidence({ references: ['x'.repeat(501)] })).toThrow(AttestationError);
    expect(sanitizeAttestationEvidence(undefined)).toEqual({});
  });

  it('validates the operator, person, basis and statement', async () => {
    for (const over of [{ attestedBy: 'synthetic-user' }, { personId: 'nope' }, { basis: 'gut_feeling' }, { statement: 'short' }, { providerUserId: '' }]) {
      await expect(recordAttestation(recordInput(over))).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(tables[ATTESTATIONS_TABLE] ?? []).toHaveLength(0);
  });

  it('concurrent attestations of one account: one row; same operator replays, another operator conflicts', async () => {
    const same = await Promise.all(Array.from({ length: 4 }, () => recordAttestation(recordInput())));
    expect(tables[ATTESTATIONS_TABLE]).toHaveLength(1);
    expect(same.filter((r) => r.replayed === false)).toHaveLength(1);
    await expect(recordAttestation(recordInput({ attestedBy: '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b' })))
      .rejects.toMatchObject({ code: 'account_already_attested' });
    await expect(recordAttestation(recordInput({ personId: OTHER_PERSON })))
      .rejects.toMatchObject({ code: 'account_already_attested' });
  });

  it('withdrawal is tenant-scoped and only from recorded', async () => {
    const { attestation } = await recordAttestation(recordInput());
    await expect(withdrawAttestation({ organizationId: CONTRACT_OTHER_ORG, attestationId: attestation.id, withdrawnBy: OPERATOR, reason: 'wrong person' }))
      .rejects.toMatchObject({ code: 'not_found' });
    const w = await withdrawAttestation({ organizationId: CONTRACT_ORG, attestationId: attestation.id, withdrawnBy: OPERATOR, reason: 'wrong person' });
    expect(w).toMatchObject({ status: 'withdrawn', withdrawnBy: OPERATOR, withdrawnReason: 'wrong person', confersVerification: false });
    await expect(withdrawAttestation({ organizationId: CONTRACT_ORG, attestationId: attestation.id, withdrawnBy: OPERATOR, reason: 'again' }))
      .rejects.toMatchObject({ code: 'not_found' });
    // A withdrawn attestation frees the account for a new one.
    expect((await recordAttestation(recordInput())).replayed).toBe(false);
  });
});

// ── 5. The route ────────────────────────────────────────────────────────────

function mockRes() {
  const res: { statusCode: number; body: Record<string, unknown> | undefined; status: (c: number) => typeof res; json: (b: unknown) => typeof res; setHeader: () => typeof res } = {
    statusCode: 0, body: undefined,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b as Record<string, unknown>; return res; },
    setHeader() { return res; },
  };
  return res;
}
const call = async (method: string, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => {
  const res = mockRes();
  await (handler as unknown as (req: unknown, res: unknown) => Promise<void>)({ method, body, query }, res);
  return res;
};
const postBody = (over: Record<string, unknown> = {}) => ({
  company_id: CONTRACT_ORG, person_id: PROVEN_PERSON, platform: 'linkedin', provider_user_id: PROVIDER_ID,
  basis: 'direct_communication', statement: 'The person confirmed this handle by email.', ...over,
});

describe('attestation route', () => {
  it('POST: membership, then PROSPECT_INGEST with phishing-resistant step-up; operator from the principal', async () => {
    const res = await call('POST', postBody({ attested_by: 'ffffffff-ffff-4fff-8fff-ffffffffffff', confers_verification: true }));
    expect(res.statusCode).toBe(201);
    expect(authCalls.map((c) => c.step)).toEqual(['access', 'capability']);
    expect(authCalls[1].opts).toMatchObject({ capability: PROSPECT_INGEST, organizationId: CONTRACT_ORG, requireStepUp: true, stepUpOverride: ATTESTATION_STEP_UP });
    expect(ATTESTATION_STEP_UP).toMatchObject({ phishingResistantOnly: true, maxAgeSeconds: 600 });
    expect(res.body).toMatchObject({ confersVerification: false, attestation: { attestedBy: OPERATOR, confersVerification: false } });
    expect(tables[ATTESTATIONS_TABLE][0].confers_verification).toBe(false);
  });

  it('GET reads without step-up; tenant comes from the verified company', async () => {
    await call('POST', postBody());
    authCalls.length = 0;
    const res = await call('GET', {}, { company_id: CONTRACT_ORG, person_id: PROVEN_PERSON });
    expect(res.statusCode).toBe(200);
    expect(authCalls[1].opts).toMatchObject({ requireStepUp: false });
    expect((res.body?.attestations as unknown[]).length).toBe(1);
    const other = await call('GET', {}, { company_id: CONTRACT_OTHER_ORG, person_id: PROVEN_PERSON });
    expect((other.body?.attestations as unknown[]).length).toBe(0);
  });

  it('denied membership or capability writes nothing', async () => {
    auth.member = false;
    expect((await call('POST', postBody())).statusCode).toBe(403);
    auth.member = true; auth.capability = false;
    expect((await call('POST', postBody())).statusCode).toBe(403);
    expect(touched).toHaveLength(0);
  });

  it('DELETE withdraws with step-up; method and input errors are refused before any write', async () => {
    const created = await call('POST', postBody());
    const id = (created.body?.attestation as { id: string }).id;
    authCalls.length = 0;
    const res = await call('DELETE', { company_id: CONTRACT_ORG, attestation_id: id, reason: 'operator error' });
    expect(res.statusCode).toBe(200);
    expect(authCalls[1].opts).toMatchObject({ requireStepUp: true, resourceId: id });
    expect((await call('PUT')).statusCode).toBe(405);
    expect((await call('POST', { company_id: 'x' })).statusCode).toBe(400);
    expect(statusForAttestationError('account_already_attested')).toBe(409);
    expect(statusForAttestationError('reference_invalid')).toBe(422);
  });
});

// ── 6. The migration ────────────────────────────────────────────────────────

describe('migration 20261231000007', () => {
  const sql = read('supabase/migrations/20270111100014_identity_verification.sql');
  const rb = read('supabase/migrations/rollbacks/identity_verification_rollback.sql');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('the attestation can never verify and is service-role only', () => {
    expect(code).toMatch(/CHECK \(confers_verification = false\)/);
    expect(code).toMatch(/CHECK \(method IN \('operator_attestation'\)\)/);
    expect(code).toMatch(/CHECK \(status IN \('recorded', 'withdrawn'\)\)/);
    expect(code).not.toMatch(/status IN \([^)]*verified/);
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(code).toMatch(/REVOKE ALL ON public\.identity_verification_attestations FROM anon, authenticated/);
    expect(code).toMatch(/FOREIGN KEY \(person_id, organization_id\)\s+REFERENCES public\.unified_persons \(id, company_id\)/);
    expect(code).not.toMatch(/SECURITY DEFINER/);
  });

  it('writes nothing to identity_claims and changes none of its constraints', () => {
    expect(code).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+(public\.)?identity_claims/i);
    expect(code).not.toMatch(/ON\s+public\.identity_claims/i);
  });

  it('the link evidence guard admits only the accepted method, consistent and current', () => {
    expect(code).toMatch(/\(v_ev ->> 'method'\) IS DISTINCT FROM 'subject_platform_oauth'/);
    expect(code).toMatch(/\(v_ev ->> 'subject_person_id'\) IS DISTINCT FROM v_claim\.person_id::text/);
    expect(code).toMatch(/\(v_ev ->> 'organization_id'\) IS DISTINCT FROM NEW\.organization_id::text/);
    expect(code).toMatch(/interval '365 days'/);
    expect(code).toMatch(/trg_community_action_journey_links_identity_proof_guard/);
    expect('trg_community_action_journey_links_identity_guard' < 'trg_community_action_journey_links_identity_proof_guard').toBe(true);
  });

  it('the rollback refuses while attestations or links exist', () => {
    expect(rb).toMatch(/EXISTS \(SELECT 1 FROM public\.identity_verification_attestations\)/);
    expect(rb).toMatch(/EXISTS \(SELECT 1 FROM public\.community_action_journey_links\)/);
    const rbCode = rb.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(rbCode).not.toMatch(/identity_claims/);
  });
});
