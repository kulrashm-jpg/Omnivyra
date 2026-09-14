/**
 * DT-C4B — validate and seal the frozen 12-company Raina corpus.
 *
 *   npx tsx backend/evaluation/canonicalGrounding/sealRaina12.ts --verify
 *
 * Read-only over the corpus: this script NEVER edits a fact. It classifies,
 * audits, serialises and hashes. Any defect is REPORTED for the independent
 * author to resolve — never silently repaired (DT-C4B §7).
 *
 * No network. No model. No production state.
 */

import { createHash } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  loadRaina12, groundingFieldCoverage, EXCLUDED_APPENDED_COMPANIES,
  RAINA12_DATASET_ID, RAINA12_DATASET_VERSION, RAINA12_PROVENANCE_CLASS,
  RAINA12_COMPANY_COUNT, GROUNDING_FIELDS_NOT_SUPPLIED,
  type Raina12Record, type RevenueClass,
} from './u1DatasetRaina12';

const OUT_FILE = join(__dirname, 'artifacts', 'u1-dataset-raina12.seal.json');

export interface Finding { code: string; severity: 'error' | 'warning' | 'info'; subject: string; detail: string; }

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>; const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return v;
}

/** §2 — the eight appended companies must be absent. */
export function auditExclusions(records: readonly Raina12Record[]): Finding[] {
  const out: Finding[] = [];
  const hay = norm(JSON.stringify(records));
  for (const excluded of EXCLUDED_APPENDED_COMPANIES) {
    if (hay.includes(norm(excluded))) {
      out.push({ code: 'EXCLUDED_COMPANY_PRESENT', severity: 'error', subject: excluded, detail: 'an out-of-scope appended company appears in the frozen corpus' });
    }
  }
  if (records.length !== RAINA12_COMPANY_COUNT) {
    out.push({ code: 'COMPANY_COUNT', severity: 'error', subject: 'corpus', detail: `expected ${RAINA12_COMPANY_COUNT}, found ${records.length}` });
  }
  return out;
}

/** §8 — machine non-duplication. Explicitly NOT semantic uniqueness. */
export function auditDistinctness(records: readonly Raina12Record[]): Finding[] {
  const out: Finding[] = [];
  const seenName = new Map<string, string>(), seenSlug = new Map<string, string>();
  for (const r of records) {
    const n = norm(r.sourceFacts.name);
    if (seenName.has(n)) out.push({ code: 'DUP_NAME', severity: 'error', subject: r.slug, detail: `duplicates ${seenName.get(n)}` });
    seenName.set(n, r.slug);
    if (seenSlug.has(r.slug)) out.push({ code: 'DUP_SLUG', severity: 'error', subject: r.slug, detail: 'slug reused' });
    seenSlug.set(r.slug, r.slug);
  }
  // Alias / containment heuristic — one name wholly inside another may indicate
  // a subsidiary or alias. Reported for HUMAN adjudication, never auto-resolved.
  for (const a of records) for (const b of records) {
    if (a.slug === b.slug) continue;
    const na = norm(a.sourceFacts.name), nb = norm(b.sourceFacts.name);
    if (na.length >= 4 && nb.includes(na)) {
      out.push({ code: 'POSSIBLE_ALIAS', severity: 'warning', subject: `${a.slug} ⊂ ${b.slug}`, detail: 'one company name contains another — requires human adjudication' });
    }
  }
  // Identical fact bundles would indicate a copied record.
  const bodies = new Map<string, string>();
  for (const r of records) {
    const key = createHash('sha256').update(JSON.stringify(stable({ ...r.sourceFacts, name: '' }))).digest('hex');
    if (bodies.has(key)) out.push({ code: 'COPIED_RECORD', severity: 'error', subject: r.slug, detail: `fact bundle identical to ${bodies.get(key)}` });
    bodies.set(key, r.slug);
  }
  return out;
}

/** §5 — synthesis must never sit inside the source-fact bundle. */
export function auditFactVsSynthesis(records: readonly Raina12Record[]): Finding[] {
  const out: Finding[] = [];
  const SYNTH_KEYS = ['fit', 'need', 'intent', 'persona', 'evidence', 'total', 'priority', 'recommendedchannel', 'outreachangle'];
  for (const r of records) {
    for (const k of Object.keys(r.sourceFacts)) {
      if (SYNTH_KEYS.includes(k.toLowerCase())) {
        out.push({ code: 'SYNTHESIS_IN_FACTS', severity: 'error', subject: `${r.slug}.${k}`, detail: 'derived intelligence found inside sourceFacts' });
      }
    }
    if (r.sourceFacts.unresolvedPersonaSlots.length > 0) {
      out.push({ code: 'PERSONA_UNRESOLVED', severity: 'info', subject: r.slug, detail: `${r.sourceFacts.unresolvedPersonaSlots.length} persona slot(s) unresolved by source — synthesis, not fact: ${r.sourceFacts.unresolvedPersonaSlots.join('; ')}` });
    }
    if (r.sourceFacts.identifiedPeople.length === 0) {
      out.push({ code: 'NO_IDENTIFIED_PERSON', severity: 'warning', subject: r.slug, detail: 'source identifies no named person; primary persona is synthesis for this company' });
    }
  }
  return out;
}

/** §6 — revenue integrity. Flags any wording that could imply actual revenue. */
export function auditRevenue(records: readonly Raina12Record[]): Finding[] {
  const out: Finding[] = [];
  const RISKY = /target|projection|ambition|expectation|run-rate|order book|initial investment/i;
  for (const r of records) {
    const claims = r.sourceFacts.revenueClaims;
    if (claims.length === 0) {
      out.push({ code: 'NO_REVENUE_CLAIM', severity: 'warning', subject: r.slug, detail: 'no revenue claim classified' });
      continue;
    }
    const hasActual = claims.some((c) => c.classification === 'VERIFIED SOURCE FACT' || c.classification === 'REPORTED FACT');
    const forwardOnly = !hasActual;
    if (forwardOnly) {
      out.push({ code: 'NO_ACTUAL_REVENUE', severity: 'warning', subject: r.slug, detail: 'no actual revenue figure exists — only forward/derived measures. Must never be described as having revenue of that size.' });
    }
    // Any verbatim mixing an actual figure with a forward figure in one string.
    if (RISKY.test(r.sourceFacts.revenueEvidenceVerbatim) && hasActual) {
      out.push({ code: 'MIXED_REVENUE_WORDING', severity: 'warning', subject: r.slug, detail: `verbatim mixes actual and forward measures — quoting it whole could imply revenue: "${r.sourceFacts.revenueEvidenceVerbatim}"` });
    }
  }
  return out;
}

/** §4/§7 — provenance completeness and Raina's own pre-freeze instructions. */
export function auditProvenance(records: readonly Raina12Record[]): Finding[] {
  const out: Finding[] = [];
  for (const r of records) {
    if (r.sourceFacts.sourceCitations.length === 0) {
      out.push({ code: 'NO_CITATION', severity: 'error', subject: r.slug, detail: 'no source citation' });
    }
    if (r.sourceFacts.reVerificationFlag) {
      out.push({ code: 'PRE_FREEZE_REVERIFICATION_REQUESTED', severity: 'warning', subject: r.slug, detail: `source author requested re-verification before freeze: "${r.sourceFacts.reVerificationFlag}" — NOT performed (DT-C4B §3 forbids new research)` });
    }
  }
  return out;
}

export function revenueSummary(records: readonly Raina12Record[]): Record<RevenueClass, number> {
  const acc = {
    'VERIFIED SOURCE FACT': 0, 'REPORTED FACT': 0, 'TARGET / PROJECTION': 0,
    'RUN-RATE': 0, 'ORDER BOOK': 0, 'NOT AVAILABLE FROM SOURCE': 0,
  } as Record<RevenueClass, number>;
  for (const r of records) for (const c of r.sourceFacts.revenueClaims) acc[c.classification]++;
  return acc;
}

/** Deterministic serialisation — no clock, no RNG, stable key order. */
export function serializeRaina12(records: readonly Raina12Record[]): string {
  return `${JSON.stringify(stable(records), null, 2)}\n`;
}

function main(): void {
  const verify = process.argv.includes('--verify');
  const records = loadRaina12();

  const findings = [
    ...auditExclusions(records), ...auditDistinctness(records),
    ...auditFactVsSynthesis(records), ...auditRevenue(records), ...auditProvenance(records),
  ];
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  const serialized = serializeRaina12(records);
  const sha256 = createHash('sha256').update(serialized).digest('hex');

  let reproducible: boolean | null = null;
  if (verify) {
    const again = createHash('sha256').update(serializeRaina12(loadRaina12())).digest('hex');
    reproducible = again === sha256;
  }

  const rev = revenueSummary(records);
  const cov = groundingFieldCoverage();

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify({
    datasetId: RAINA12_DATASET_ID, version: RAINA12_DATASET_VERSION,
    provenanceClass: RAINA12_PROVENANCE_CLASS, companyCount: records.length,
    sha256, serializedBytes: Buffer.byteLength(serialized, 'utf8'),
    excludedCompanies: EXCLUDED_APPENDED_COMPANIES,
    revenueSummary: rev, groundingFieldCoverage: cov, findings,
  }, null, 2)}\n`, 'utf8');

  const lines = [
    'DT-C4B — RAINA 12-COMPANY CORPUS FREEZE',
    '========================================',
    `datasetId:     ${RAINA12_DATASET_ID}`,
    `version:       ${RAINA12_DATASET_VERSION}`,
    `provenance:    ${RAINA12_PROVENANCE_CLASS}`,
    `companies:     ${records.length}`,
    `excluded:      ${EXCLUDED_APPENDED_COMPANIES.length} appended companies, none present`,
    `serialized:    ${Buffer.byteLength(serialized, 'utf8')} bytes`,
    `SHA-256:       ${sha256}`,
    verify ? `reproducible:  ${reproducible ? 'YES' : 'NO'}` : 'reproducible:  (pass --verify)',
    '',
    'REVENUE CLASSIFICATION (claims, not companies):',
    ...Object.entries(rev).map(([k, v]) => `  ${String(v).padStart(2)}  ${k}`),
    '',
    'GROUNDING FIELD COVERAGE (of 12 companies):',
    ...cov.map((c) => `  ${String(c.populated).padStart(2)}/${c.total}  ${c.field}`),
    '',
    `AUDIT: ${errors.length} error(s), ${warnings.length} warning(s)`,
    ...findings.map((f) => `  [${f.severity}] ${f.code} ${f.subject}: ${f.detail}`),
    '',
    `seal artifact: ${OUT_FILE}`,
    '',
    'Machine string comparison establishes non-duplication; it does not establish',
    'semantic uniqueness. No fact was authored, inferred, researched or repaired.',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  void GROUNDING_FIELDS_NOT_SUPPLIED;
  if (errors.length > 0) process.exit(1);
  if (verify && !reproducible) process.exit(1);
}

main();
