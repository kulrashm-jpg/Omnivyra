/**
 * DT-C4 — independent-certification gate invariants.
 *
 * ⚠️ Every certification object in this file is SYNTHETIC TEST DATA, prefixed
 * SYNTHETIC_. None is a real certification, none names a real person, and none
 * may ever be cited as evidence that independence was achieved. They exist only
 * to prove the gate accepts what it should and refuses what it must.
 *
 * The live state is asserted separately: CURRENT_CERTIFICATION is null and the
 * v2 dataset is NOT_VERIFIED.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CURRENT_CERTIFICATION, evaluateIndependence, sealWithCertification,
  certificationFingerprint, describeIndependence, CertificationRequiredError,
  type IndependentAuthorCertification,
} from '../../evaluation/canonicalGrounding/u1Certification';
import {
  loadU1Dataset002, u1DatasetSpecs,
  U1_DATASET_ID, U1_DATASET_VERSION, U1_DATASET_PROVENANCE_CLASS,
} from '../../evaluation/canonicalGrounding/u1Dataset002';
import { sealDataset } from '../../evaluation/canonicalGrounding/u1DatasetValidator';
import { DATASET_SHA256_V2 } from '../../evaluation/canonicalGrounding/u1Protocol002';
import * as v1Protocol from '../../evaluation/canonicalGrounding/u1Protocol';
import * as v2Protocol from '../../evaluation/canonicalGrounding/u1Protocol002';
import { loadGoldenDataset } from '../../evaluation/canonicalGrounding/dataset';

const CERT_SRC = join(__dirname, '../../evaluation/canonicalGrounding/u1Certification.ts');
const entries = loadU1Dataset002();
const specs = u1DatasetSpecs();
const IDENTITY = {
  datasetId: U1_DATASET_ID,
  datasetVersion: U1_DATASET_VERSION,
  provenanceClass: U1_DATASET_PROVENANCE_CLASS,
};

/** SYNTHETIC — a fully-compliant certification, used only to prove the gate opens. */
function SYNTHETIC_validCert(): IndependentAuthorCertification {
  return {
    certificationId: 'SYNTHETIC-CERT-TEST-ONLY',
    datasetId: U1_DATASET_ID,
    datasetSha256: DATASET_SHA256_V2,
    authorRef: 'SYNTHETIC-reviewer-01',
    authorRole: 'synthetic test reviewer',
    signedOn: '2026-09-10',
    attestations: {
      didNotImplementSystemUnderTest: true,
      didNotImplementEvaluationInfrastructure: true,
      notMerelyNominalApprover: true,
      authorshipMode: 'authored',
      certifiedSemanticDistinctness: true,
      approvedBeforeFirstExecution: true,
    },
    nonExposure: {
      sawGroundedOutputs: false,
      sawUngroundedOutputs: false,
      sawScorerResults: false,
      sawSuccessFailureResults: false,
      anyModelOutputInfluencedDataset: false,
    },
    semanticDistinctness: {
      procedure: 'SYNTHETIC procedure text for gate testing only.',
      acknowledgesMachineLimitationIsInsufficient: true,
      companiesReviewed: specs.length,
      certified: true,
    },
    provenance: specs.map((s) => ({
      companySlug: s.slug,
      realOrSynthetic: 'synthetic' as const,
      sourceDescription: 'SYNTHETIC test provenance.',
      externallyVerifiable: false,
      authoredOrVerifiedBy: 'SYNTHETIC-reviewer-01',
      reviewedByIndependentHuman: true,
    })),
  };
}

const EXPECTED = { datasetId: U1_DATASET_ID, datasetSha256: DATASET_SHA256_V2 };

describe('DT-C4 — live state: independence is NOT verified', () => {
  it('no certification record exists for the v2 dataset', () => {
    expect(CURRENT_CERTIFICATION).toBeNull();
  });

  it('the v2 dataset evaluates to NOT_VERIFIED', () => {
    const a = evaluateIndependence(CURRENT_CERTIFICATION, EXPECTED);
    expect(a.verdict).toBe('NOT_VERIFIED');
    expect(a.certificationPresent).toBe(false);
    expect(a.satisfied).toBe(0);
    expect(a.reasons.join(' ')).toMatch(/ENGINEERING FIXTURE/);
  });

  it('refuses to produce a certified seal in the current state', () => {
    expect(() => sealWithCertification(entries, specs, IDENTITY, CURRENT_CERTIFICATION))
      .toThrow(CertificationRequiredError);
  });

  it('describes the verdict without overstating it', () => {
    expect(describeIndependence(evaluateIndependence(CURRENT_CERTIFICATION, EXPECTED)))
      .toMatch(/^INDEPENDENCE NOT VERIFIED/);
  });
});

describe('DT-C4 — the gate refuses every path to false independence', () => {
  const cases: [string, (c: IndependentAuthorCertification) => void][] = [
    ['author implemented the system under test', (c) => { c.attestations.didNotImplementSystemUnderTest = false; }],
    ['author implemented the evaluation infrastructure', (c) => { c.attestations.didNotImplementEvaluationInfrastructure = false; }],
    ['author was a nominal approver only', (c) => { c.attestations.notMerelyNominalApprover = false; }],
    ['author neither authored nor verified the facts', (c) => { c.attestations.authorshipMode = null; }],
    ['author saw grounded outputs', (c) => { c.nonExposure.sawGroundedOutputs = true; }],
    ['author saw ungrounded outputs', (c) => { c.nonExposure.sawUngroundedOutputs = true; }],
    ['author saw scorer results', (c) => { c.nonExposure.sawScorerResults = true; }],
    ['author saw success/failure results', (c) => { c.nonExposure.sawSuccessFailureResults = true; }],
    ['model output influenced the dataset', (c) => { c.nonExposure.anyModelOutputInfluencedDataset = true; }],
  ];

  it.each(cases)('NOT_VERIFIED when: %s', (_label, mutate) => {
    const cert = SYNTHETIC_validCert();
    mutate(cert);
    const a = evaluateIndependence(cert, EXPECTED);
    expect(a.verdict).toBe('NOT_VERIFIED');
    expect(() => sealWithCertification(entries, specs, IDENTITY, cert)).toThrow(CertificationRequiredError);
  });

  it('NOT_VERIFIED when the certification is bound to a different dataset hash', () => {
    const cert = SYNTHETIC_validCert();
    cert.datasetSha256 = 'f'.repeat(64);
    const a = evaluateIndependence(cert, EXPECTED);
    expect(a.verdict).toBe('NOT_VERIFIED');
    expect(a.reasons.join(' ')).toMatch(/dataset changed after certification|belongs elsewhere/);
  });

  it('a certification is invalidated by any edit to the dataset it covers', () => {
    const cert = SYNTHETIC_validCert();
    const mutated = JSON.parse(JSON.stringify(entries)) as typeof entries;
    (mutated[0].profile as Record<string, unknown>).unique_value = 'tampered after certification';
    const newHash = sealDataset(mutated, specs, IDENTITY).sha256;
    expect(newHash).not.toBe(DATASET_SHA256_V2);
    const a = evaluateIndependence(cert, { datasetId: U1_DATASET_ID, datasetSha256: newHash });
    expect(a.verdict).toBe('NOT_VERIFIED');
  });

  it('PARTIALLY_VERIFIED when independence holds but semantic review is incomplete', () => {
    const cert = SYNTHETIC_validCert();
    cert.semanticDistinctness.certified = false;
    cert.attestations.certifiedSemanticDistinctness = false;
    const a = evaluateIndependence(cert, EXPECTED);
    expect(a.verdict).toBe('PARTIALLY_VERIFIED');
    expect(a.reasons.join(' ')).toMatch(/INCOMPLETE/);
    expect(() => sealWithCertification(entries, specs, IDENTITY, cert)).toThrow(CertificationRequiredError);
  });

  it('PARTIALLY_VERIFIED when the reviewer does not acknowledge the machine-test limitation', () => {
    const cert = SYNTHETIC_validCert();
    cert.semanticDistinctness.acknowledgesMachineLimitationIsInsufficient = false;
    expect(evaluateIndependence(cert, EXPECTED).verdict).toBe('PARTIALLY_VERIFIED');
  });

  it('PARTIALLY_VERIFIED when per-company provenance was not reviewed', () => {
    const cert = SYNTHETIC_validCert();
    cert.provenance[0].reviewedByIndependentHuman = false;
    expect(evaluateIndependence(cert, EXPECTED).verdict).toBe('PARTIALLY_VERIFIED');
  });

  it('VERIFIED only when every requirement holds — and only then does sealing succeed', () => {
    const cert = SYNTHETIC_validCert();
    const a = evaluateIndependence(cert, EXPECTED);
    expect(a.verdict).toBe('VERIFIED');
    expect(a.satisfied).toBe(a.required);
    const seal = sealWithCertification(entries, specs, IDENTITY, cert);
    expect(seal.independenceVerdict).toBe('VERIFIED');
    expect(seal.sha256).toBe(DATASET_SHA256_V2);
    expect(seal.certificationFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DT-C4 — the agent cannot self-certify', () => {
  it('exposes no factory, builder or default that could synthesise a certification', () => {
    const src = readFileSync(CERT_SRC, 'utf8');
    expect(src).not.toMatch(/export function (create|build|make|default)[A-Za-z]*Certification/);
    expect(src).toMatch(/export const CURRENT_CERTIFICATION: IndependentAuthorCertification \| null = null;/);
  });

  it('offers no bypass, override or force flag on the sealing gate', () => {
    const src = readFileSync(CERT_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/force|bypass|skipCertification|allowUncertified/i);
  });

  it('has no default-to-verified path: absent record yields NOT_VERIFIED', () => {
    expect(evaluateIndependence(null, EXPECTED).verdict).toBe('NOT_VERIFIED');
  });

  it('certification fingerprint is deterministic and content-sensitive', () => {
    const a = SYNTHETIC_validCert();
    expect(certificationFingerprint(a)).toBe(certificationFingerprint(SYNTHETIC_validCert()));
    const b = SYNTHETIC_validCert();
    b.authorRef = 'SYNTHETIC-reviewer-02';
    expect(certificationFingerprint(b)).not.toBe(certificationFingerprint(a));
  });
});

describe('DT-C4 — purity, isolation and prior-artifact integrity', () => {
  it('performs no I/O, network, clock or database access', () => {
    const src = readFileSync(CERT_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/writeFileSync|readFileSync|createWriteStream/);
    expect(code).not.toMatch(/fetch\(|axios|http:|https:/);
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)|Math\.random\(\)/);
    expect(code).not.toMatch(/supabase|ownedDbTable|\.insert\(|\.upsert\(/);
    expect(code).not.toMatch(/openai|anthropic/i);
  });

  it('does not mutate the dataset or the certification it is given', () => {
    const cert = SYNTHETIC_validCert();
    const certBefore = JSON.stringify(cert);
    const entriesBefore = JSON.stringify(entries);
    evaluateIndependence(cert, EXPECTED);
    sealWithCertification(entries, specs, IDENTITY, cert);
    expect(JSON.stringify(cert)).toBe(certBefore);
    expect(JSON.stringify(entries)).toBe(entriesBefore);
  });

  it('v1 dataset remains unchanged', () => {
    const v1 = loadGoldenDataset();
    expect(v1).toHaveLength(9);
    expect(v1[0].id).toBe('eval-00-small-none');
  });

  it('u1-001 remains unchanged', () => {
    expect(v1Protocol.PROTOCOL_VERSION).toBe('u1-001');
    expect(v1Protocol.protocolFingerprint()).toBe('b204e168');
    expect(v1Protocol.PROTOCOL_DATASET_ID).toBe('canonicalGrounding.goldenDataset.v1');
  });

  it('u1-002 remains unchanged, and its acceptance criteria are untouched', () => {
    expect(v2Protocol.PROTOCOL_VERSION_V2).toBe('u1-002');
    expect(v2Protocol.protocolFingerprintV2()).toBe('3c93760a');
    expect(v2Protocol.DATASET_SHA256_V2).toBe(DATASET_SHA256_V2);
    expect(v2Protocol.MIN_RELATIVE_REDUCTION).toBe(v1Protocol.MIN_RELATIVE_REDUCTION);
    expect(v2Protocol.ACCEPTANCE_RULES).toBe(v1Protocol.ACCEPTANCE_RULES);
    expect(v2Protocol.METRICS).toBe(v1Protocol.METRICS);
  });

  it('the v2 dataset itself is unchanged by DT-C4', () => {
    expect(sealDataset(entries, specs, IDENTITY).sha256).toBe(DATASET_SHA256_V2);
  });
});
