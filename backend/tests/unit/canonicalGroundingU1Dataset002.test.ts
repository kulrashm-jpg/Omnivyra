/**
 * DT-C3 — U1 dataset v2 + protocol u1-002 invariants.
 *
 * These tests prove DATASET-QUALITY and PROTOCOL-STRUCTURE properties only.
 * None asserts anything about model efficacy, and no model is invoked.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadU1Dataset002, u1DatasetSpecs, deriveCoreOfferings,
  U1_DATASET_ID, U1_DATASET_VERSION, U1_DATASET_PROVENANCE_CLASS, U1_EVAL_EPOCH,
} from '../../evaluation/canonicalGrounding/u1Dataset002';
import {
  auditDistinctness, auditConsistency, auditRequiredFields,
  serializeDataset, sealDataset,
} from '../../evaluation/canonicalGrounding/u1DatasetValidator';
import {
  PROTOCOL_VERSION_V2, PROTOCOL_SUPERSEDES, DATASET_ID_V2, DATASET_SHA256_V2,
  DATASET_COMPANY_COUNT_V2, DATASET_PAIR_COUNT_V2, INDEPENDENCE_LIMITATIONS,
  STATISTICAL_TREATMENT_V2, protocolFingerprintV2,
} from '../../evaluation/canonicalGrounding/u1Protocol002';
import * as v1Protocol from '../../evaluation/canonicalGrounding/u1Protocol';
import * as v2Protocol from '../../evaluation/canonicalGrounding/u1Protocol002';
import { loadGoldenDataset } from '../../evaluation/canonicalGrounding/dataset';
import { WORKLOADS } from '../../evaluation/canonicalGrounding/workloads';

const DATASET_SRC = join(__dirname, '../../evaluation/canonicalGrounding/u1Dataset002.ts');
const V1_DATASET_SRC = join(__dirname, '../../evaluation/canonicalGrounding/dataset.ts');

const entries = loadU1Dataset002();
const specs = u1DatasetSpecs();

describe('DT-C3 (1) minimum company count', () => {
  it('contains at least 20 companies', () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
    expect(entries.length).toBe(DATASET_COMPANY_COUNT_V2);
  });

  it('expected pair count matches workload coverage', () => {
    expect(DATASET_PAIR_COUNT_V2).toBe(entries.length * WORKLOADS.length);
  });
});

describe('DT-C3 (2) unique company identity', () => {
  it('has unique ids, slugs and names', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(new Set(specs.map((s) => s.slug)).size).toBe(specs.length);
    expect(new Set(specs.map((s) => s.name)).size).toBe(specs.length);
  });

  it('spans distinct industries', () => {
    expect(new Set(specs.map((s) => s.industry)).size).toBe(specs.length);
  });
});

describe('DT-C3 (3) substantive distinctness', () => {
  it('passes the deterministic distinctness audit with zero errors', () => {
    const r = auditDistinctness(specs);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.checked).toBe(specs.length);
  });

  it('shares no substantive scalar value between any two companies', () => {
    for (const field of ['uniqueValue', 'idealCustomerProfile', 'brandPositioning',
      'brandVoice', 'businessModel', 'marketContext', 'category'] as const) {
      const vals = specs.map((s) => String(s[field]).toLowerCase().trim());
      expect(new Set(vals).size).toBe(specs.length);
    }
  });

  it('shares no individual list element between any two companies', () => {
    for (const field of ['offerings', 'painSymptoms', 'competitiveAdvantages',
      'contentThemes', 'growthPriorities', 'namedCompetitors', 'audienceRoles'] as const) {
      const all = specs.flatMap((s) => (s[field] as string[]).map((x) => x.toLowerCase().trim()));
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('detects a copied fixture when one is deliberately introduced', () => {
    const cloned = [...specs, { ...specs[0], slug: 'clone', name: 'Cloneco' }];
    const r = auditDistinctness(cloned);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'COPIED_FIXTURE')).toBe(true);
  });
});

describe('DT-C3 (4) required fields', () => {
  it('passes the required-field audit', () => {
    const r = auditRequiredFields(entries);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it('provides a balanced completeness distribution', () => {
    const d = entries.reduce<Record<string, number>>((a, e) => {
      a[e.completeness] = (a[e.completeness] ?? 0) + 1; return a;
    }, {});
    expect(d.rich).toBeGreaterThanOrEqual(10);
    expect(d.sparse).toBeGreaterThanOrEqual(1);
    expect(d.none).toBeGreaterThanOrEqual(1);
  });
});

describe('DT-C3 (5) internal consistency', () => {
  it('passes the consistency audit with zero errors', () => {
    const r = auditConsistency(entries);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.passed).toBe(true);
  });
});

describe('DT-C3 (6) no unresolved market_pulse / products_services contradiction', () => {
  it('core_offerings equals products_services_list for every market-enabled rich entry', () => {
    let checked = 0;
    for (const e of entries) {
      const p = e.profile as Record<string, unknown>;
      const mp = ((p.report_settings as Record<string, unknown>)?.market_pulse ?? {}) as Record<string, unknown>;
      const list = p.products_services_list as string[] | undefined;
      const core = mp.core_offerings as string[] | undefined;
      if (!list || !core) continue;
      expect([...core].sort()).toEqual([...list].sort());
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('core_offerings is derived, so it cannot drift from the offerings', () => {
    for (const s of specs) expect(deriveCoreOfferings(s)).toEqual([...s.offerings]);
  });

  it('the audit catches the v1-style contradiction when injected', () => {
    const broken = JSON.parse(JSON.stringify(entries)) as typeof entries;
    const target = broken.find((e) => (e.profile as Record<string, unknown>).products_services_list)!;
    ((target.profile as Record<string, unknown>).report_settings as Record<string, unknown>).market_pulse =
      { core_offerings: ['Analytics suite', 'Attribution engine'] };
    const r = auditConsistency(broken);
    expect(r.passed).toBe(false);
    expect(r.findings.some((f) => f.code === 'OFFERINGS_CONTRADICTION')).toBe(true);
  });
});

describe('DT-C3 (7,8) deterministic serialization and stable hash', () => {
  it('serializes byte-identically across independent loads', () => {
    expect(serializeDataset(loadU1Dataset002())).toBe(serializeDataset(loadU1Dataset002()));
  });

  it('produces the sealed hash recorded in the protocol', () => {
    const seal = sealDataset(entries, specs, {
      datasetId: U1_DATASET_ID, datasetVersion: U1_DATASET_VERSION,
      provenanceClass: U1_DATASET_PROVENANCE_CLASS,
    });
    expect(seal.sha256).toBe(DATASET_SHA256_V2);
    expect(seal.errorCount).toBe(0);
    expect(seal.audits).toEqual({ distinctness: true, consistency: true, requiredFields: true });
  });

  it('hash is a pure function of content — a single edit changes it', () => {
    const a = createHash('sha256').update(serializeDataset(entries)).digest('hex');
    const mutated = JSON.parse(JSON.stringify(entries)) as typeof entries;
    (mutated[0].profile as Record<string, unknown>).name = 'Changed';
    const b = createHash('sha256').update(serializeDataset(mutated)).digest('hex');
    expect(a).not.toBe(b);
    expect(a).toBe(DATASET_SHA256_V2);
  });

  it('uses a fixed epoch, never a wall clock', () => {
    const src = readFileSync(DATASET_SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now\(\)|Math\.random\(\)/);
    expect(U1_EVAL_EPOCH).toBe(Date.parse('2026-07-15T00:00:00Z'));
    expect(entries.every((e) => e.now === U1_EVAL_EPOCH)).toBe(true);
  });
});

describe('DT-C3 (9,10) protocol references the correct dataset identity and hash', () => {
  it('u1-002 points at the v2 dataset and its sealed hash', () => {
    expect(PROTOCOL_VERSION_V2).toBe('u1-002');
    expect(DATASET_ID_V2).toBe(U1_DATASET_ID);
    expect(DATASET_SHA256_V2).toMatch(/^[0-9a-f]{64}$/);
    expect(protocolFingerprintV2()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('declares independence NOT VERIFIED and refuses generalisation', () => {
    expect(INDEPENDENCE_LIMITATIONS.verdict).toBe('INDEPENDENCE NOT VERIFIED');
    expect(INDEPENDENCE_LIMITATIONS.externallyValidated).toBe(false);
    expect(INDEPENDENCE_LIMITATIONS.syntheticCompanies).toBe(true);
    expect(STATISTICAL_TREATMENT_V2.generalisation).toMatch(/NONE/);
    expect(STATISTICAL_TREATMENT_V2.status).toMatch(/EXPLORATORY/);
  });

  it('does NOT weaken any acceptance criterion relative to u1-001', () => {
    expect(v2Protocol.MIN_RELATIVE_REDUCTION).toBe(v1Protocol.MIN_RELATIVE_REDUCTION);
    expect(v2Protocol.MIN_VALID_PAIR_RATIO).toBe(v1Protocol.MIN_VALID_PAIR_RATIO);
    expect(v2Protocol.MIN_INTER_RATER_ALPHA).toBe(v1Protocol.MIN_INTER_RATER_ALPHA);
    expect(v2Protocol.MIN_RATERS).toBe(v1Protocol.MIN_RATERS);
    expect(v2Protocol.PRIMARY_METRIC).toBe(v1Protocol.PRIMARY_METRIC);
    // Identity, not equality: the same frozen objects are re-exported.
    expect(v2Protocol.ACCEPTANCE_RULES).toBe(v1Protocol.ACCEPTANCE_RULES);
    expect(v2Protocol.EXCLUSION_RULES).toBe(v1Protocol.EXCLUSION_RULES);
    expect(v2Protocol.METRICS).toBe(v1Protocol.METRICS);
    expect(v2Protocol.HUMAN_RATING_PROTOCOL).toBe(v1Protocol.HUMAN_RATING_PROTOCOL);
  });
});

describe('DT-C3 (11,12) no model invocation, no production mutation', () => {
  it('dataset and validator declare no provider or network import', () => {
    for (const f of ['u1Dataset002.ts', 'u1DatasetValidator.ts', 'u1Protocol002.ts']) {
      const src = readFileSync(join(__dirname, '../../evaluation/canonicalGrounding', f), 'utf8');
      const imports = (src.match(/^import .*$/gm) ?? []).join('\n');
      expect(imports).not.toMatch(/openai|anthropic|node-fetch|axios|https?:/i);
    }
  });

  it('performs no database, cache or filesystem write', () => {
    for (const f of ['u1Dataset002.ts', 'u1DatasetValidator.ts', 'u1Protocol002.ts']) {
      const src = readFileSync(join(__dirname, '../../evaluation/canonicalGrounding', f), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/writeFileSync|appendFileSync/);
      expect(code).not.toMatch(/supabase|ownedDbTable|\.insert\(|\.upsert\(/);
      expect(code).not.toMatch(/createCache|registerCacheNamespace/);
    }
  });

  it('does not mutate its inputs during auditing', () => {
    const before = JSON.stringify(entries);
    auditDistinctness(specs); auditConsistency(entries); auditRequiredFields(entries);
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('DT-C3 (13) v1 dataset preserved unchanged', () => {
  it('goldenDataset.v1 still loads with its original 9 entries and ids', () => {
    const v1 = loadGoldenDataset();
    expect(v1).toHaveLength(9);
    expect(v1[0].id).toBe('eval-00-small-none');
    expect(v1.every((e) => e.id.startsWith('eval-'))).toBe(true);
  });

  it('v1 retains its original duplicated-fact shape — v2 did not edit it', () => {
    const rich = loadGoldenDataset().filter((e) => e.completeness === 'rich');
    const values = rich.map((e) => (e.profile as Record<string, unknown>).unique_value);
    // v1's L-1 defect is still present, by design: v1 is preserved, not repaired.
    expect(new Set(values).size).toBe(1);
  });

  it('v1 source file is untouched by DT-C3', () => {
    const src = readFileSync(V1_DATASET_SRC, 'utf8');
    expect(src).toMatch(/RF-3A — deterministic, reproducible golden dataset/);
    expect(src).not.toMatch(/u1Dataset|DT-C3|u1-002/);
  });
});

describe('DT-C3 (14,15) versioning and protocol separation', () => {
  it('the new dataset carries its own identity and version', () => {
    expect(U1_DATASET_ID).toBe('canonicalGrounding.u1Dataset.v2');
    expect(U1_DATASET_VERSION).toBe('v2');
    expect(U1_DATASET_PROVENANCE_CLASS).toMatch(/NOT INDEPENDENTLY AUTHORED/);
  });

  it('u1-001 is NOT reused for the new dataset', () => {
    expect(PROTOCOL_VERSION_V2).not.toBe(v1Protocol.PROTOCOL_VERSION);
    expect(PROTOCOL_SUPERSEDES).toBe(v1Protocol.PROTOCOL_VERSION);
    // u1-001 remains bound to the v1 dataset.
    expect(v1Protocol.PROTOCOL_DATASET_ID).toBe('canonicalGrounding.goldenDataset.v1');
    expect(v1Protocol.PROTOCOL_DATASET_ID).not.toBe(DATASET_ID_V2);
  });

  it('u1-001 fingerprint is unchanged by the existence of u1-002', () => {
    expect(v1Protocol.protocolFingerprint()).toBe('b204e168');
    expect(protocolFingerprintV2()).not.toBe(v1Protocol.protocolFingerprint());
  });
});
