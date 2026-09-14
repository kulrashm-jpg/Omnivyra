/**
 * DT-C4B — frozen Raina 12-company corpus invariants.
 *
 * These prove DATASET-INTEGRITY and PROTOCOL-BINDING properties only. None
 * asserts anything about grounding efficacy, and no model is invoked.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadRaina12, raina12GroundingFacts, groundingFieldCoverage,
  RAINA12_DATASET_ID, RAINA12_DATASET_VERSION, RAINA12_COMPANY_COUNT,
  EXCLUDED_APPENDED_COMPANIES, GROUNDING_FIELDS_NOT_SUPPLIED,
} from '../../evaluation/canonicalGrounding/u1DatasetRaina12';
import {
  auditExclusions, auditDistinctness, auditFactVsSynthesis, auditRevenue,
  auditProvenance, revenueSummary, serializeRaina12,
} from '../../evaluation/canonicalGrounding/sealRaina12';
import {
  PROTOCOL_VERSION_V4, PROTOCOL_SUPERSEDES_V4, DATASET_ID_V4, DATASET_SHA256_V4,
  DATASET_COMPANY_COUNT_V4, DATASET_PAIR_COUNT_V4, COUNT_DISCLOSURE,
  GROUNDING_SPARSITY_DISCLOSURE, STATISTICAL_TREATMENT_V4,
  protocolFingerprintV4, evidenceCeilingV4,
} from '../../evaluation/canonicalGrounding/u1Protocol004';
import * as v1Protocol from '../../evaluation/canonicalGrounding/u1Protocol';
import * as v2Protocol from '../../evaluation/canonicalGrounding/u1Protocol002';
import * as v4Protocol from '../../evaluation/canonicalGrounding/u1Protocol004';
import { loadGoldenDataset } from '../../evaluation/canonicalGrounding/dataset';
import { u1DatasetSpecs, loadU1Dataset002 } from '../../evaluation/canonicalGrounding/u1Dataset002';
import { sealDataset } from '../../evaluation/canonicalGrounding/u1DatasetValidator';

const records = loadRaina12();
const DATASET_SRC = join(__dirname, '../../evaluation/canonicalGrounding/u1DatasetRaina12.ts');

describe('DT-C4B (1) corpus integrity — exactly the 12 in scope', () => {
  it('contains exactly 12 companies', () => {
    expect(records).toHaveLength(12);
    expect(RAINA12_COMPANY_COUNT).toBe(12);
    expect(auditExclusions(records).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('contains precisely the 12 named companies', () => {
    expect(records.map((r) => r.sourceFacts.name)).toEqual([
      'Secure IT Simply', 'Tensech Solutions', 'Dreamtime Learning', 'TAUTMORE', 'Kruu',
      'INLIFE Healthcare', 'MrMed', 'Sensivision Health Technologies', 'Vector Technics',
      'Hummingbird Consulting', 'Yoho', 'NXTFACE',
    ]);
  });
});

describe('DT-C4B (2) the eight appended companies are excluded', () => {
  it('lists all eight as out of scope', () => {
    expect(EXCLUDED_APPENDED_COMPANIES).toEqual([
      'SpesNet', 'Speso', 'Spetrol', 'SPETECH', 'SPETS AB',
      'Spetco International Petroleum Co.', 'Spesafacile', 'Spesasicura',
    ]);
  });

  it('none appears anywhere in the frozen corpus', () => {
    const hay = JSON.stringify(records).toLowerCase();
    for (const name of EXCLUDED_APPENDED_COMPANIES) {
      expect(hay).not.toContain(name.toLowerCase());
    }
  });

  it('the exclusion audit detects one if it is injected', () => {
    const contaminated = [...records, {
      ...records[0], slug: 'spesnet',
      sourceFacts: { ...records[0].sourceFacts, name: 'SpesNet' },
    }];
    const f = auditExclusions(contaminated);
    expect(f.some((x) => x.code === 'EXCLUDED_COMPANY_PRESENT')).toBe(true);
  });
});

describe('DT-C4B (3) not derived from the DT-C3 synthetic corpus', () => {
  it('shares no company name with the 22 synthetic companies', () => {
    const synth = new Set(u1DatasetSpecs().map((s) => s.name.toLowerCase()));
    for (const r of records) expect(synth.has(r.sourceFacts.name.toLowerCase())).toBe(false);
  });

  it('shares no industry with the synthetic corpus', () => {
    const synth = new Set(u1DatasetSpecs().map((s) => s.industry.toLowerCase()));
    for (const r of records) expect(synth.has(r.sourceFacts.industry.toLowerCase())).toBe(false);
  });
});

describe('DT-C4B (4) fact vs synthesis separation', () => {
  it('no derived intelligence leaks into sourceFacts', () => {
    expect(auditFactVsSynthesis(records).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('every record carries synthesis in a separate object', () => {
    for (const r of records) {
      expect(r.derivedIntelligence).toBeDefined();
      expect(r.sourceFacts).not.toHaveProperty('total');
      expect(r.sourceFacts).not.toHaveProperty('priority');
      expect(r.sourceFacts).not.toHaveProperty('outreachAngle');
    }
  });

  it('the grounding projection excludes all synthesis', () => {
    for (const g of raina12GroundingFacts()) {
      for (const k of ['fit', 'need', 'intent', 'persona', 'evidence', 'total', 'priority',
        'recommendedChannel', 'outreachAngle']) {
        expect(g).not.toHaveProperty(k);
      }
    }
  });

  it('records unresolved persona slots as synthesis rather than fact', () => {
    const tautmore = records.find((r) => r.slug === 'tautmore')!;
    expect(tautmore.sourceFacts.identifiedPeople).toHaveLength(0);
    expect(tautmore.sourceFacts.unresolvedPersonaSlots.length).toBeGreaterThan(0);
  });
});

describe('DT-C4B (5) revenue integrity — no prohibited transformation', () => {
  it('classifies every revenue claim', () => {
    for (const r of records) {
      expect(r.sourceFacts.revenueClaims.length).toBeGreaterThan(0);
      for (const c of r.sourceFacts.revenueClaims) expect(c.classification).toBeTruthy();
    }
  });

  it('never converts a target, run-rate, order book or investment into revenue', () => {
    const cls = (slug: string, needle: string) =>
      records.find((r) => r.slug === slug)!.sourceFacts.revenueClaims
        .find((c) => c.verbatim.includes(needle))!.classification;
    expect(cls('tensech-solutions', '₹10 Cr FY26 target')).toBe('TARGET / PROJECTION');
    expect(cls('kruu', '₹18–20 Cr annualised target')).toBe('TARGET / PROJECTION');
    expect(cls('vector-technics', 'monthly run-rate')).toBe('RUN-RATE');
    expect(cls('vector-technics', 'order book')).toBe('ORDER BOOK');
    expect(cls('hummingbird-consulting', '₹10 Cr 2025 target')).toBe('TARGET / PROJECTION');
    expect(cls('nxtface', '₹100 Cr 2026 ambition')).toBe('TARGET / PROJECTION');
    expect(cls('sensivision', '₹4Cr→₹20–30Cr')).toBe('TARGET / PROJECTION');
  });

  it('records the only third-party-verified revenue figures as such', () => {
    const mrmed = records.find((r) => r.slug === 'mrmed')!.sourceFacts.revenueClaims;
    expect(mrmed.find((c) => c.verbatim === '₹33.5 Cr FY25')!.classification).toBe('VERIFIED SOURCE FACT');
    const yoho = records.find((r) => r.slug === 'yoho')!.sourceFacts.revenueClaims;
    expect(yoho.find((c) => c.verbatim === '₹17 Cr+ FY24')!.classification).toBe('VERIFIED SOURCE FACT');
  });

  it('flags companies with no actual revenue figure', () => {
    const flagged = auditRevenue(records).filter((f) => f.code === 'NO_ACTUAL_REVENUE').map((f) => f.subject);
    expect(flagged).toEqual(expect.arrayContaining(['sensivision', 'vector-technics', 'hummingbird-consulting']));
  });

  it('summary totals match the classified claims', () => {
    const s = revenueSummary(records);
    expect(s['VERIFIED SOURCE FACT']).toBe(3);
    expect(s['RUN-RATE']).toBe(1);
    expect(s['ORDER BOOK']).toBe(1);
    expect(s['TARGET / PROJECTION']).toBeGreaterThanOrEqual(7);
  });
});

describe('DT-C4B (6) provenance', () => {
  it('every company carries at least one source citation', () => {
    expect(auditProvenance(records).filter((f) => f.code === 'NO_CITATION')).toEqual([]);
    for (const r of records) expect(r.sourceFacts.sourceCitations.length).toBeGreaterThan(0);
  });

  it('surfaces the source author unresolved pre-freeze re-verification requests', () => {
    const flagged = auditProvenance(records)
      .filter((f) => f.code === 'PRE_FREEZE_REVERIFICATION_REQUESTED').map((f) => f.subject);
    expect(flagged).toEqual(['secure-it-simply', 'tautmore', 'sensivision']);
  });

  it('preserves revenue evidence verbatim, unmodified', () => {
    expect(records.find((r) => r.slug === 'vector-technics')!.sourceFacts.revenueEvidenceVerbatim)
      .toBe('Current monthly run-rate ₹3–5 Cr; FY order book ₹40 Cr');
    expect(records.find((r) => r.slug === 'mrmed')!.sourceFacts.revenueEvidenceVerbatim)
      .toBe('₹33.5 Cr FY25; ₹23.9 Cr FY24');
  });
});

describe('DT-C4B (7) distinctness — machine only', () => {
  it('finds no duplicate, alias or copied record', () => {
    expect(auditDistinctness(records).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('states its own limitation in the source', () => {
    const src = readFileSync(join(__dirname, '../../evaluation/canonicalGrounding/sealRaina12.ts'), 'utf8');
    expect(src).toMatch(/non-duplication.*not.*semantic uniqueness/is);
  });
});

describe('DT-C4B (8) grounding-field sparsity is recorded, not remedied', () => {
  it('supplies only name, industry and growth signal', () => {
    const cov = groundingFieldCoverage();
    expect(cov.find((c) => c.field === 'name')!.populated).toBe(12);
    expect(cov.find((c) => c.field === 'industry')!.populated).toBe(12);
    for (const f of GROUNDING_FIELDS_NOT_SUPPLIED) {
      expect(cov.find((c) => c.field === f)!.populated).toBe(0);
    }
  });

  it('the absent fields were NOT invented anywhere in the corpus', () => {
    const src = readFileSync(DATASET_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const f of ['unique_value:', 'brand_voice:', 'pain_symptoms:', 'competitive_advantages:',
      'ideal_customer_profile:', 'content_themes:']) {
      expect(code).not.toContain(f);
    }
  });

  it('the protocol discloses the sparsity and forbids remedying it', () => {
    expect(GROUNDING_SPARSITY_DISCLOSURE.fieldsAbsent.length).toBe(12);
    expect(GROUNDING_SPARSITY_DISCLOSURE.consequence).toMatch(/REDUCES/);
    expect(GROUNDING_SPARSITY_DISCLOSURE.doNotRemedy).toMatch(/must NOT be filled in/);
  });
});

describe('DT-C4B (9) deterministic serialization and stable hash', () => {
  it('serializes byte-identically across independent loads', () => {
    expect(serializeRaina12(loadRaina12())).toBe(serializeRaina12(loadRaina12()));
  });

  it('produces the sealed hash recorded in u1-004', () => {
    const sha = createHash('sha256').update(serializeRaina12(records)).digest('hex');
    expect(sha).toBe(DATASET_SHA256_V4);
  });

  it('the hash is content-sensitive', () => {
    const mutated = JSON.parse(JSON.stringify(records)) as typeof records;
    (mutated[0].sourceFacts as { name: string }).name = 'Changed';
    const sha = createHash('sha256').update(serializeRaina12(mutated)).digest('hex');
    expect(sha).not.toBe(DATASET_SHA256_V4);
  });

  it('carries no wall clock or RNG', () => {
    const src = readFileSync(DATASET_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)|Math\.random\(\)/);
  });
});

describe('DT-C4B (10) protocol binding u1-004', () => {
  it('binds to the frozen corpus identity and hash', () => {
    expect(PROTOCOL_VERSION_V4).toBe('u1-004');
    expect(PROTOCOL_SUPERSEDES_V4).toBe('u1-003');
    expect(DATASET_ID_V4).toBe(RAINA12_DATASET_ID);
    expect(RAINA12_DATASET_VERSION).toBe('raina12-v1');
    expect(DATASET_COMPANY_COUNT_V4).toBe(12);
    expect(DATASET_PAIR_COUNT_V4).toBe(156);
    expect(protocolFingerprintV4()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does NOT weaken any acceptance criterion', () => {
    expect(v4Protocol.MIN_RELATIVE_REDUCTION).toBe(v1Protocol.MIN_RELATIVE_REDUCTION);
    expect(v4Protocol.MIN_VALID_PAIR_RATIO).toBe(v1Protocol.MIN_VALID_PAIR_RATIO);
    expect(v4Protocol.MIN_INTER_RATER_ALPHA).toBe(v1Protocol.MIN_INTER_RATER_ALPHA);
    expect(v4Protocol.MIN_RATERS).toBe(v1Protocol.MIN_RATERS);
    expect(v4Protocol.PRIMARY_METRIC).toBe(v1Protocol.PRIMARY_METRIC);
    expect(v4Protocol.ACCEPTANCE_RULES).toBe(v1Protocol.ACCEPTANCE_RULES);
    expect(v4Protocol.EXCLUSION_RULES).toBe(v1Protocol.EXCLUSION_RULES);
    expect(v4Protocol.METRICS).toBe(v1Protocol.METRICS);
    expect(v4Protocol.HUMAN_RATING_PROTOCOL).toBe(v1Protocol.HUMAN_RATING_PROTOCOL);
  });

  it('carries the mandatory count disclosure and refuses to claim the >=20 target', () => {
    expect(COUNT_DISCLOSURE).toMatch(/fewer companies than the original internal target of >=20/);
    expect(COUNT_DISCLOSURE).toMatch(/intentional/);
  });

  it('declares exploratory status and refuses generalisation', () => {
    expect(STATISTICAL_TREATMENT_V4.status).toMatch(/EXPLORATORY/);
    expect(STATISTICAL_TREATMENT_V4.generalisation).toMatch(/NONE/);
    expect(STATISTICAL_TREATMENT_V4.independence).toMatch(/VIOLATED/);
  });

  it('does not upgrade the evidence rung merely because the corpus was frozen', () => {
    const c = evidenceCeilingV4();
    expect(c.currentRung).toBe(1);
    expect(c.rationale).toMatch(/Freezing a corpus is not/);
    expect(c.ceiling).toBeLessThan(6);
  });
});

describe('DT-C4B (11) prior artifacts unchanged', () => {
  it('goldenDataset.v1 unchanged', () => {
    const v1 = loadGoldenDataset();
    expect(v1).toHaveLength(9);
    expect(v1[0].id).toBe('eval-00-small-none');
  });

  it('u1Dataset.v2 unchanged', () => {
    expect(sealDataset(loadU1Dataset002(), u1DatasetSpecs(), {
      datasetId: 'canonicalGrounding.u1Dataset.v2', datasetVersion: 'v2',
      provenanceClass: 'SYNTHETIC — NOT INDEPENDENTLY AUTHORED',
    }).sha256).toBe('369e2165568305a5e7ae7658c5b939d94957da369b995f837bf37e9efdfd7442');
  });

  it('u1-001 and u1-002 fingerprints unchanged', () => {
    expect(v1Protocol.protocolFingerprint()).toBe('b204e168');
    expect(v2Protocol.protocolFingerprintV2()).toBe('3c93760a');
    expect(v1Protocol.PROTOCOL_DATASET_ID).toBe('canonicalGrounding.goldenDataset.v1');
  });
});
