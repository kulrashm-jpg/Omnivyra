/**
 * CPG-058 — company-administrator attestation.
 *
 * Public-domain evidence first; the authenticated company administrator
 * second; the two kept separately traceable. Every fixture is synthetic
 * (reserved .example domains, invented tenants) — no customer data.
 *
 * Each test asserts the PRECONDITION it depends on (the state resolve()
 * actually produced), so a fixture that stops producing that state fails
 * loudly instead of silently testing something else.
 */

import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { applyUserDecision } from '../../services/companyProfile/grounding/confirmation';
import {
  applyAdministratorAttestation, AttestationError, ATTESTATION_PROMPTS, classifyEvidence,
  describeEvidence, EVIDENCE_CLASS_LABELS, latestAttestation, type AttestationRequest,
} from '../../services/companyProfile/grounding/administratorAttestation';
import {
  applyAdministratorAttestationGuarded, applyUserDecisionGuarded, AuthorizationError,
  isCompanyAdministratorRole, TenantIsolationError, type AccessContext, type GroundingRole,
} from '../../services/companyProfile/grounding/groundingAccess';
import type { EntitySignals, EvidenceClaim, GroundedField, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-21T00:00:00.000Z';
const LATER = '2026-09-22T00:00:00.000Z';
const TENANT_A = 'tenant-alpha';
const TENANT_B = 'tenant-beta';
const DOMAIN = 'alpha.example';
const ADMIN = 'admin-user-1';

const KNOWN: EntitySignals = {
  companyName: 'Alpha Example Co', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null,
};

const norm = (v: string) => v.toLowerCase().trim();

function userClaim(value: string, by = 'member-user-9'): UserClaim {
  return { field: 'industry', value, normalizedValue: norm(value), assertedAt: '2026-08-01T00:00:00.000Z', assertedBy: by };
}

function evidence(claimId: string, value: string, over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    claimId, field: 'industry', value, normalizedValue: norm(value),
    sourceType: 'editorial', sourceName: 'Example Press', sourceUrl: `https://press.example/${claimId}`,
    sourcePublishedAt: '2026-08-01T00:00:00.000Z', sourceAccessedAt: '2026-09-01T00:00:00.000Z',
    excerpt: null, verificationMethod: 'crawl',
    entitySignals: { companyName: 'Alpha Example Co', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
    ...over,
  };
}
/** A tier-1 first-party page on the company's own domain. */
const firstParty = (claimId: string, value: string) =>
  evidence(claimId, value, { sourceType: 'company_website', sourceName: 'Alpha Example Co', sourceUrl: `https://${DOMAIN}/about` });

const R = (o: Partial<Parameters<typeof resolve>[0]> = {}): GroundedField => resolve({
  companyId: TENANT_A, field: 'industry', kind: 'FACT', userClaim: null, evidence: [],
  knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, ...o,
});

const req = (value: string, extra: Partial<AttestationRequest> = {}): AttestationRequest => ({ value, normalizedValue: norm(value), ...extra });
const attest = (g: GroundedField, value: string, extra: Partial<AttestationRequest> = {}, asOf = ASOF) =>
  applyAdministratorAttestation({ grounded: g, request: req(value, extra), attestedBy: ADMIN, asOf });

const ctx = (role: GroundingRole, companyId = TENANT_A, userId = ADMIN): AccessContext => ({ userId, memberships: [{ companyId, role }] });

// Fixtures, each checked against the state it must produce.
const verifiedUserValue = () => {
  const g = R({ userClaim: userClaim('Cybersecurity'), evidence: [firstParty('e1', 'Cybersecurity')] });
  expect(g.status).toBe('PUBLICLY_VERIFIED');
  expect(g.effectiveValueSource).toBe('user');
  return g;
};
const nothingKnown = () => {
  const g = R();
  expect(g.status).toBe('UNVERIFIED');
  expect(g.effectiveValue).toBeNull();
  return g;
};

describe('CPG-058 (1) administrator-attested is distinguishable from PUBLICLY_VERIFIED', () => {
  it('the two classes, labels and verification flags differ', () => {
    const verified = verifiedUserValue();
    const attested = attest(nothingKnown(), 'Cybersecurity');
    expect(classifyEvidence(verified)).toBe('PUBLICLY_VERIFIED');
    expect(classifyEvidence(attested)).toBe('ADMINISTRATOR_ATTESTED');
    expect(describeEvidence(verified).independentlyVerified).toBe(true);
    expect(describeEvidence(attested).independentlyVerified).toBe(false);
    expect(describeEvidence(attested).label).toBe(EVIDENCE_CLASS_LABELS.ADMINISTRATOR_ATTESTED);
    expect(describeEvidence(attested).label).toMatch(/not independently verified/);
  });

  it('only the PUBLICLY_VERIFIED label may claim verification without a negation', () => {
    for (const [cls, label] of Object.entries(EVIDENCE_CLASS_LABELS)) {
      if (cls === 'PUBLICLY_VERIFIED') expect(label).toMatch(/verified/i);
      else if (/verified/i.test(label)) expect(label).toMatch(/not (independently )?verified/i);
    }
  });
});

describe('CPG-058 (2) missing or insufficient public evidence falls back to the administrator (Case B)', () => {
  it('no public evidence: the attested value is used and recorded as ADMINISTRATOR_ATTESTED', () => {
    const g = attest(nothingKnown(), 'Cybersecurity', { reason: 'current positioning' });
    expect(g.effectiveValue).toBe('Cybersecurity');
    expect(g.status).toBe('USER_PROVIDED');
    expect(classifyEvidence(g)).toBe('ADMINISTRATOR_ATTESTED');
    const a = latestAttestation(g)!;
    expect(a).toMatchObject({
      sourceType: 'ADMINISTRATOR', authority: 'COMPANY_ADMIN', attestedBy: ADMIN, attestedAt: ASOF,
      companyId: TENANT_A, field: 'industry', value: 'Cybersecurity',
      previousValue: null, previousStatus: 'UNVERIFIED', reason: 'current positioning',
      publicEvidence: 'NONE', publicEvidenceConsidered: [], conflictStatus: 'NONE',
      verificationStatus: 'NOT_INDEPENDENTLY_VERIFIED',
    });
    expect(g.history[g.history.length - 1].action).toBe('user_asserted');
  });

  it('agreeing public evidence below the verified bar: still administrator-attested, never verified', () => {
    const g0 = R({ userClaim: userClaim('Cybersecurity'), evidence: [evidence('w1', 'Cybersecurity', { entitySignals: { companyName: 'Alpha Example Co', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null } })] });
    expect(g0.status).not.toBe('PUBLICLY_VERIFIED');
    const g = attest(g0, 'Cybersecurity');
    expect(g.status).not.toBe('PUBLICLY_VERIFIED');
    expect(classifyEvidence(g)).toBe('ADMINISTRATOR_ATTESTED');
    expect(latestAttestation(g)!.publicEvidence).toBe('BELOW_VERIFIED_BAR');
  });
});

describe('CPG-058 (3) public evidence is never relabelled as administrator-attested', () => {
  it('Case A — attesting a publicly verified value changes nothing about the public record', () => {
    const g0 = verifiedUserValue();
    const g = attest(g0, 'Cybersecurity');
    expect(g.status).toBe('PUBLICLY_VERIFIED');                     // no downgrade
    expect(classifyEvidence(g)).toBe('PUBLICLY_VERIFIED');
    expect(g.evidence).toEqual(g0.evidence);
    expect(g.conflictingEvidence).toEqual(g0.conflictingEvidence);
    expect(g.effectiveValue).toBe(g0.effectiveValue);
    expect(latestAttestation(g)!.verificationStatus).toBe('CORROBORATED_BY_PUBLIC_EVIDENCE');
    expect(describeEvidence(g).administratorConfirmed).toBe(true);
  });

  it('a publicly sourced effective value keeps its public class after the administrator agrees', () => {
    const g0 = R({ evidence: [firstParty('p1', 'Cybersecurity'), evidence('p2', 'Cybersecurity', { sourceType: 'business_intelligence', sourceUrl: 'https://directory.example/alpha' })] });
    expect(g0.effectiveValueSource).toBe('public_evidence');
    const before = classifyEvidence(g0);
    const g = attest(g0, 'Cybersecurity');
    expect(classifyEvidence(g)).toBe(before);
    expect(classifyEvidence(g)).not.toBe('ADMINISTRATOR_ATTESTED');
    expect(g.evidence.map((e) => e.sourceType)).toEqual(g0.evidence.map((e) => e.sourceType));
  });

  it('a public value in use but only PUBLICLY_REPORTED is not relabelled when the administrator agrees', () => {
    // Name-only identity: enough agreeing evidence to be used, not enough identity to verify.
    const nameOnly: EntitySignals = { companyName: 'Alpha Example Co', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null };
    const g0 = R({ evidence: [
      evidence('r1', 'Cybersecurity', { sourceUrl: 'https://press-one.example/a', entitySignals: nameOnly }),
      evidence('r2', 'Cybersecurity', { sourceType: 'business_intelligence', sourceUrl: 'https://directory.example/b', entitySignals: nameOnly }),
    ] });
    expect(g0.effectiveValueSource).toBe('public_evidence');
    expect(g0.status).toBe('PUBLICLY_REPORTED');
    const g = attest(g0, 'Cybersecurity');
    expect(classifyEvidence(g)).toBe('PUBLICLY_REPORTED');
    expect(g.status).toBe('PUBLICLY_REPORTED');
    expect(describeEvidence(g).administratorConfirmed).toBe(true);
  });
});

describe('CPG-058 (4) an attestation never becomes PUBLICLY_VERIFIED because an authenticated user entered it', () => {
  it.each([
    ['nothing known', () => nothingKnown()],
    ['a user-provided value', () => R({ userClaim: userClaim('Retail') })],
    ['a user/public conflict', () => R({ userClaim: userClaim('Retail'), evidence: [firstParty('c1', 'Cybersecurity')] })],
  ])('from %s', (_label, make) => {
    const g0 = make();
    expect(g0.status).not.toBe('PUBLICLY_VERIFIED');
    for (const flag of [false, true]) {
      const g = attest(g0, 'Fintech', { useAttestedValueOverPublic: flag });
      expect(g.status).not.toBe('PUBLICLY_VERIFIED');
      expect(classifyEvidence(g)).not.toBe('PUBLICLY_VERIFIED');
      expect(describeEvidence(g).independentlyVerified).toBe(false);
    }
  });
});

describe('CPG-058 (5) a public/administrator conflict preserves both sources (Case C)', () => {
  it('without an explicit choice nothing is replaced; the conflict is surfaced', () => {
    const g0 = verifiedUserValue();
    const g = attest(g0, 'Fintech');
    expect(g.effectiveValue).toBe('Cybersecurity');
    expect(g.userClaim).toEqual(g0.userClaim);
    expect(g.evidence).toEqual(g0.evidence);
    expect(g.conflictingEvidence).toEqual(g0.conflictingEvidence);
    expect(g.status).toBe('CONFLICTING');
    expect(g.isMaterialConflict).toBe(true);
    expect(g.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
    expect(classifyEvidence(g)).toBe('CONFLICTING');
    const a = latestAttestation(g)!;
    expect(a.conflictStatus).toBe('UNRESOLVED');
    expect(a.value).toBe('Fintech');
    expect(a.publicEvidenceConsidered.map((p) => p.claimId)).toContain('e1');
    expect(describeEvidence(g).prompt).toBe(ATTESTATION_PROMPTS.CONFLICT);
  });

  it("the administrator's explicit choice puts their value in use; public evidence stays on record", () => {
    const g0 = verifiedUserValue();
    const open = attest(g0, 'Fintech');
    const g = attest(open, 'Fintech', { useAttestedValueOverPublic: true }, LATER);
    expect(g.effectiveValue).toBe('Fintech');
    expect(g.status).toBe('CONFLICTING');                 // the disagreement is real and stays on record
    expect(g.isMaterialConflict).toBe(false);
    expect(g.confirmationStatus).toBe('USER_CONFIRMED_OWN_VALUE');
    expect(g.evidence).toEqual(g0.evidence);
    expect(classifyEvidence(g)).toBe('ADMINISTRATOR_ATTESTED');
    expect(describeEvidence(g).publicConflict).toBe('RESOLVED_BY_ADMINISTRATOR');
    const trail = g.history.filter((h) => h.attestation).map((h) => h.attestation!.conflictStatus);
    expect(trail).toEqual(['UNRESOLVED', 'RESOLVED_ATTESTED_VALUE']);
  });

  it('choosing the public value restores its status — no downgrade', () => {
    const open = attest(verifiedUserValue(), 'Fintech');
    const g = attest(open, 'Cybersecurity', {}, LATER);
    expect(g.status).toBe('PUBLICLY_VERIFIED');
    expect(g.isMaterialConflict).toBe(false);
    expect(classifyEvidence(g)).toBe('PUBLICLY_VERIFIED');
  });
});

describe('CPG-058 (6) an administrator correction preserves history (Case E)', () => {
  it('a new version is appended; the earlier attestation and entries are untouched', () => {
    const g1 = attest(nothingKnown(), 'Cybersecurity');
    const snapshot = JSON.parse(JSON.stringify(g1));
    const g2 = attest(g1, 'Cyber Security Services', {}, LATER);
    expect(g1).toEqual(snapshot);                                   // input never mutated
    expect(g2.history.slice(0, g1.history.length)).toEqual(g1.history);
    expect(g2.history).toHaveLength(g1.history.length + 1);
    expect(g2.history[g2.history.length - 1].action).toBe('user_corrected');
    expect(g2.effectiveValueSource).toBe('user_correction');
    const all = g2.history.filter((h) => h.attestation).map((h) => h.attestation!.value);
    expect(all).toEqual(['Cybersecurity', 'Cyber Security Services']);
    expect(latestAttestation(g2)!.previousValue).toBe('Cybersecurity');
    expect(classifyEvidence(g2)).toBe('ADMINISTRATOR_ATTESTED');
  });
});

describe('CPG-058 (7) unauthorised users cannot create administrator attestations', () => {
  it('viewer and editor are refused; admin is allowed', () => {
    const g = nothingKnown();
    expect(() => applyAdministratorAttestationGuarded(ctx('viewer'), g, req('Cybersecurity'), ASOF)).toThrow(AuthorizationError);
    expect(() => applyAdministratorAttestationGuarded(ctx('editor'), g, req('Cybersecurity'), ASOF)).toThrow(AuthorizationError);
    const ok = applyAdministratorAttestationGuarded(ctx('admin'), g, req('Cybersecurity'), ASOF);
    expect(classifyEvidence(ok)).toBe('ADMINISTRATOR_ATTESTED');
  });

  it('editors keep their existing decision rights — unchanged', () => {
    const g0 = R({ userClaim: userClaim('Retail'), evidence: [firstParty('c1', 'Cybersecurity')] });
    const out = applyUserDecisionGuarded(ctx('editor'), g0, { kind: 'confirm_own' }, ASOF);
    expect(out.confirmationStatus).toBe('USER_CONFIRMED_OWN_VALUE');
  });

  it('the attester is pinned to the authenticated user; a request cannot name someone else', () => {
    const smuggled = { ...req('Cybersecurity'), attestedBy: 'someone-else' } as unknown as AttestationRequest;
    const g = applyAdministratorAttestationGuarded(ctx('admin'), nothingKnown(), smuggled, ASOF);
    expect(latestAttestation(g)!.attestedBy).toBe(ADMIN);
    expect(g.userClaim!.assertedBy).toBe(ADMIN);
  });

  it('only the canonical COMPANY_ADMIN role is a company administrator — SUPER_ADMIN is not', () => {
    expect(isCompanyAdministratorRole('COMPANY_ADMIN')).toBe(true);
    for (const r of ['SUPER_ADMIN', 'ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY', 'company_admin', '', null, undefined]) {
      expect(isCompanyAdministratorRole(r)).toBe(false);
    }
  });

  it("an editor's later change is not presented as administrator-attested", () => {
    const attested = attest(nothingKnown(), 'Cybersecurity');
    const edited = applyUserDecision({ grounded: attested, decision: { kind: 'correct', newValue: 'Retail', normalizedValue: 'retail' }, actor: 'editor-user-2', asOf: LATER });
    expect(edited.effectiveValue).toBe('Retail');
    expect(classifyEvidence(edited)).toBe('USER_PROVIDED');
    expect(describeEvidence(edited).administratorConfirmed).toBe(false);
  });
});

describe('CPG-058 (8) tenant isolation remains intact', () => {
  it("an administrator of one tenant cannot attest another tenant's field", () => {
    const foreign = R({ companyId: TENANT_B });
    expect(() => applyAdministratorAttestationGuarded(ctx('admin', TENANT_A), foreign, req('Cybersecurity'), ASOF))
      .toThrow(TenantIsolationError);
  });

  it('the attestation takes company and field from the authorized record, never the request', () => {
    const smuggled = { ...req('Cybersecurity'), companyId: TENANT_B, field: 'revenue' } as unknown as AttestationRequest;
    const g = applyAdministratorAttestationGuarded(ctx('admin', TENANT_A), nothingKnown(), smuggled, ASOF);
    expect(latestAttestation(g)).toMatchObject({ companyId: TENANT_A, field: 'industry' });
  });

  it("another company's attestation carried in history is ignored", () => {
    const planted = attest(R({ companyId: TENANT_B }), 'Cybersecurity');
    const g = R({ userClaim: userClaim('Cybersecurity'), priorHistory: planted.history });
    expect(latestAttestation(g)).toBeNull();
    expect(classifyEvidence(g)).toBe('USER_PROVIDED');
  });
});

describe('CPG-058 (9) without administrator confirmation, unverified stays unverified (Case D)', () => {
  it('nothing is inferred or populated, and the administrator is asked', () => {
    const g = nothingKnown();
    expect(classifyEvidence(g)).toBe('UNVERIFIED');
    const d = describeEvidence(g);
    expect(d.administratorConfirmed).toBe(false);
    expect(d.prompt).toBe(ATTESTATION_PROMPTS.INSUFFICIENT);
    expect(g.effectiveValue).toBeNull();
  });

  it('a blank attestation is refused, not recorded', () => {
    expect(() => attest(nothingKnown(), '   ')).toThrow(AttestationError);
  });

  it("a non-administrator's value stays USER_PROVIDED", () => {
    expect(classifyEvidence(R({ userClaim: userClaim('Retail') }))).toBe('USER_PROVIDED');
  });

  it('an Omnivyra synthesis cannot be attested as an organisational fact', () => {
    expect(() => attest(R({ kind: 'SYNTHESIS' }), 'Anything')).toThrow(AttestationError);
  });
});

describe('CPG-058 (10) existing CPG public-evidence behaviour is unchanged', () => {
  it('resolve() output carries no attestation and classifies as its own status', () => {
    for (const g of [nothingKnown(), verifiedUserValue(), R({ userClaim: userClaim('Retail'), evidence: [firstParty('c1', 'Cybersecurity')] })]) {
      expect(g.history.some((h) => h.attestation)).toBe(false);
      expect(classifyEvidence(g)).toBe(g.isMaterialConflict ? 'CONFLICTING' : g.status);
    }
  });

  it('existing user decisions produce their existing states and never an attestation', () => {
    const g0 = R({ userClaim: userClaim('Retail'), evidence: [firstParty('c1', 'Cybersecurity')] });
    const own = applyUserDecision({ grounded: g0, decision: { kind: 'confirm_own' }, actor: 'u', asOf: ASOF });
    expect(own.status).toBe('CONFLICTING');
    expect(own.history.some((h) => h.attestation)).toBe(false);
    expect(classifyEvidence(own)).toBe('CONFLICTING');
  });

  it('an attestation survives re-resolution through history', () => {
    const attested = attest(nothingKnown(), 'Cybersecurity');
    const again = R({ userClaim: attested.userClaim, priorHistory: attested.history, asOf: LATER });
    expect(classifyEvidence(again)).toBe('ADMINISTRATOR_ATTESTED');
  });

  it('later public verification outranks the attestation, which stays on record', () => {
    const attested = attest(nothingKnown(), 'Cybersecurity');
    const again = R({ userClaim: attested.userClaim, priorHistory: attested.history, evidence: [firstParty('e9', 'Cybersecurity')], asOf: LATER });
    expect(again.status).toBe('PUBLICLY_VERIFIED');
    expect(classifyEvidence(again)).toBe('PUBLICLY_VERIFIED');
    expect(latestAttestation(again)).not.toBeNull();
  });

  it('later conflicting public evidence is surfaced, not hidden behind the attestation', () => {
    const attested = attest(nothingKnown(), 'Cybersecurity');
    const again = R({ userClaim: attested.userClaim, priorHistory: attested.history, evidence: [firstParty('e9', 'Fintech')], asOf: LATER });
    expect(again.isMaterialConflict).toBe(true);
    expect(classifyEvidence(again)).toBe('CONFLICTING');
  });
});

describe('CPG-058 provenance UI exposes no personal information', () => {
  it("the description names the role, never the administrator's identity", () => {
    const d = describeEvidence(attest(nothingKnown(), 'Cybersecurity'));
    expect(JSON.stringify(d)).not.toContain(ADMIN);
    expect(d.administratorConfirmedAt).toBe(ASOF);
  });
});
