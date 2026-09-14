/**
 * DT-C3 — U1 dataset quality audit + sealing (evaluation-only, pure).
 *
 * Three deterministic audits, plus a sealing function:
 *
 *   1. DISTINCTNESS  — no two companies share an identity or a substantive fact
 *                      value. This is the machine check for the v1 L-1 defect.
 *   2. CONSISTENCY   — no company contradicts itself. Specifically, the v1 L-2
 *                      defect: `market_pulse.core_offerings` must agree with
 *                      `products_services_list`.
 *   3. REQUIRED      — every record carries the fields its completeness tier
 *                      promises.
 *
 * ⚠️ LIMITATIONS OF THE DISTINCTNESS TEST — READ BEFORE CITING IT ⚠️
 * These are EXACT and NORMALISED-EXACT string comparisons. They prove that no
 * two companies were built by copying a field. They do NOT prove semantic
 * uniqueness: two companies could describe near-identical businesses in
 * different words and pass every check here. Semantic distinctness can only be
 * certified by human review, which this module does not perform and does not
 * claim. A PASS here means "not duplicated", never "meaningfully different".
 *
 * PURITY: no I/O, no network, no clock, no RNG, no database. Same input → same
 * output. Uses node:crypto for hashing only (a pure function of its input).
 */

import { createHash } from 'crypto';
import type { DatasetEntry } from './types';
import type { CompanySpec } from './u1Dataset002';

// ── shared helpers ───────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Stable key ordering → byte-identical serialisation. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return value;
}

export interface Finding {
  code: string;
  severity: 'error' | 'warning';
  subject: string;
  detail: string;
}

export interface AuditReport {
  passed: boolean;
  checked: number;
  findings: Finding[];
}

// ── 1. DISTINCTNESS ──────────────────────────────────────────────────────────

/** Substantive fields that must never repeat across companies. */
const SUBSTANTIVE_FIELDS: (keyof CompanySpec)[] = [
  'name', 'industry', 'category', 'uniqueValue', 'idealCustomerProfile',
  'brandPositioning', 'brandVoice', 'businessModel', 'marketContext',
];
/** Substantive list fields whose *bundle* must never repeat across companies. */
const SUBSTANTIVE_LISTS: (keyof CompanySpec)[] = [
  'offerings', 'audienceRoles', 'painSymptoms', 'competitiveAdvantages',
  'contentThemes', 'growthPriorities', 'namedCompetitors',
];

export function auditDistinctness(specs: readonly CompanySpec[]): AuditReport {
  const findings: Finding[] = [];

  const slugs = new Map<string, string>();
  for (const s of specs) {
    if (slugs.has(s.slug)) findings.push({ code: 'DUP_SLUG', severity: 'error', subject: s.slug, detail: `slug reused by ${slugs.get(s.slug)}` });
    slugs.set(s.slug, s.name);
  }

  // Scalar substantive fields: normalised-exact duplication is an error.
  for (const field of SUBSTANTIVE_FIELDS) {
    const seen = new Map<string, string>();
    for (const s of specs) {
      const raw = s[field];
      if (typeof raw !== 'string') continue;
      const key = norm(raw);
      const prior = seen.get(key);
      if (prior) {
        findings.push({ code: 'DUP_FIELD', severity: 'error', subject: `${s.slug}.${String(field)}`, detail: `duplicates ${prior}` });
      }
      seen.set(key, `${s.slug}.${String(field)}`);
    }
  }

  // List fields: both the whole bundle AND any individual element must be unique.
  for (const field of SUBSTANTIVE_LISTS) {
    const seenBundle = new Map<string, string>();
    const seenItem = new Map<string, string>();
    for (const s of specs) {
      const raw = s[field];
      if (!Array.isArray(raw)) continue;
      const items = (raw as string[]).map(norm);
      const bundle = [...items].sort().join('|');
      const priorBundle = seenBundle.get(bundle);
      if (priorBundle) {
        findings.push({ code: 'DUP_BUNDLE', severity: 'error', subject: `${s.slug}.${String(field)}`, detail: `identical bundle to ${priorBundle}` });
      }
      seenBundle.set(bundle, `${s.slug}.${String(field)}`);
      for (const item of items) {
        const priorItem = seenItem.get(item);
        if (priorItem) {
          findings.push({ code: 'DUP_ITEM', severity: 'error', subject: `${s.slug}.${String(field)}`, detail: `value "${item}" also in ${priorItem}` });
        }
        seenItem.set(item, `${s.slug}.${String(field)}`);
      }
    }
  }

  // A whole-record fingerprint collision means a copied fixture.
  const bodies = new Map<string, string>();
  for (const s of specs) {
    const { slug, name, ...rest } = s;
    const key = createHash('sha256').update(JSON.stringify(stable(rest))).digest('hex');
    const prior = bodies.get(key);
    if (prior) findings.push({ code: 'COPIED_FIXTURE', severity: 'error', subject: slug, detail: `record body identical to ${prior} (only identity differs)` });
    bodies.set(key, slug);
    void name;
  }

  return { passed: findings.every((f) => f.severity !== 'error'), checked: specs.length, findings };
}

// ── 2. CONSISTENCY (the v1 L-2 defect) ───────────────────────────────────────

/** Fields compared for internal contradiction, per §7 of the task. */
export const CONSISTENCY_FIELDS = Object.freeze([
  'report_settings.market_pulse.core_offerings', 'products_services_list', 'products_services',
  'unique_value', 'ideal_customer_profile', 'target_audience', 'industry', 'name',
  'report_settings.discovered_metadata.description', 'content_themes', 'content_themes_list',
]);

export function auditConsistency(entries: readonly DatasetEntry[]): AuditReport {
  const findings: Finding[] = [];

  for (const e of entries) {
    const p = e.profile as Record<string, unknown>;
    const rs = (p.report_settings ?? {}) as Record<string, unknown>;
    const mp = (rs.market_pulse ?? {}) as Record<string, unknown>;
    const dm = (rs.discovered_metadata ?? {}) as Record<string, unknown>;

    const list = Array.isArray(p.products_services_list) ? (p.products_services_list as string[]) : null;
    const core = Array.isArray(mp.core_offerings) ? (mp.core_offerings as string[]) : null;

    // THE v1 L-2 CHECK — core_offerings must not contradict products_services_list.
    if (list && core) {
      const a = [...list].map(norm).sort().join('|');
      const b = [...core].map(norm).sort().join('|');
      if (a !== b) {
        findings.push({
          code: 'OFFERINGS_CONTRADICTION', severity: 'error', subject: e.id,
          detail: `market_pulse.core_offerings [${core.join(', ')}] contradicts products_services_list [${list.join(', ')}]`,
        });
      }
    }

    // products_services (string) must agree with products_services_list.
    if (list && typeof p.products_services === 'string') {
      const joined = norm(list.join(', '));
      if (norm(p.products_services) !== joined) {
        findings.push({ code: 'PRODUCTS_STRING_MISMATCH', severity: 'error', subject: e.id, detail: 'products_services string disagrees with products_services_list' });
      }
    }

    // content_themes (string) must agree with content_themes_list.
    if (Array.isArray(p.content_themes_list) && typeof p.content_themes === 'string') {
      if (norm(p.content_themes) !== norm((p.content_themes_list as string[]).join(', '))) {
        findings.push({ code: 'THEMES_MISMATCH', severity: 'error', subject: e.id, detail: 'content_themes disagrees with content_themes_list' });
      }
    }

    // target_audience must agree with ideal_customer_profile where both exist.
    if (typeof p.target_audience === 'string' && typeof p.ideal_customer_profile === 'string') {
      if (norm(p.target_audience) !== norm(p.ideal_customer_profile)) {
        findings.push({ code: 'AUDIENCE_MISMATCH', severity: 'warning', subject: e.id, detail: 'target_audience differs from ideal_customer_profile' });
      }
    }

    // Discovered metadata description must restate the company's own value prop.
    if (typeof dm.description === 'string' && typeof p.unique_value === 'string') {
      if (norm(dm.description as string) !== norm(p.unique_value)) {
        findings.push({ code: 'DESCRIPTION_MISMATCH', severity: 'error', subject: e.id, detail: 'discovered_metadata.description contradicts unique_value' });
      }
    }

    // The entry-level industry must match the profile's own industry.
    if (typeof p.industry === 'string' && norm(p.industry) !== norm(e.industry)) {
      findings.push({ code: 'INDUSTRY_MISMATCH', severity: 'error', subject: e.id, detail: 'profile.industry disagrees with entry.industry' });
    }
  }

  return { passed: findings.every((f) => f.severity !== 'error'), checked: entries.length, findings };
}

// ── 3. REQUIRED FIELDS ───────────────────────────────────────────────────────

const RICH_REQUIRED = [
  'name', 'industry', 'category', 'products_services', 'products_services_list',
  'unique_value', 'ideal_customer_profile', 'target_audience', 'pain_symptoms',
  'competitive_advantages', 'brand_positioning', 'brand_voice', 'content_themes',
  'growth_priorities', 'business_model',
];

export function auditRequiredFields(entries: readonly DatasetEntry[]): AuditReport {
  const findings: Finding[] = [];
  for (const e of entries) {
    const p = e.profile as Record<string, unknown>;
    if (e.completeness === 'rich') {
      for (const f of RICH_REQUIRED) {
        const v = p[f];
        const empty = v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
        if (empty) findings.push({ code: 'MISSING_REQUIRED', severity: 'error', subject: `${e.id}.${f}`, detail: 'required for completeness=rich' });
      }
    }
    if (e.completeness === 'sparse') {
      for (const f of ['name', 'industry']) {
        if (!p[f]) findings.push({ code: 'MISSING_REQUIRED', severity: 'error', subject: `${e.id}.${f}`, detail: 'required for completeness=sparse' });
      }
      if (p.unique_value) findings.push({ code: 'UNEXPECTED_FIELD', severity: 'error', subject: `${e.id}.unique_value`, detail: 'sparse records must not carry rich fields' });
    }
    if (e.completeness === 'none' && (p.name || p.industry)) {
      findings.push({ code: 'UNEXPECTED_FIELD', severity: 'error', subject: e.id, detail: 'completeness=none must carry no first-party profile fields' });
    }
  }
  return { passed: findings.every((f) => f.severity !== 'error'), checked: entries.length, findings };
}

// ── SEALING ──────────────────────────────────────────────────────────────────

export interface DatasetSeal {
  datasetId: string;
  datasetVersion: string;
  provenanceClass: string;
  companyCount: number;
  /** SHA-256 over the deterministic serialisation of the dataset entries. */
  sha256: string;
  serializedBytes: number;
  audits: { distinctness: boolean; consistency: boolean; requiredFields: boolean };
  errorCount: number;
}

/** Deterministic serialisation — stable key order, fixed entry order. */
export function serializeDataset(entries: readonly DatasetEntry[]): string {
  return `${JSON.stringify(stable(entries), null, 2)}\n`;
}

/**
 * Seal the dataset: hash it and record the audit outcome. A seal is only
 * meaningful alongside its audits — a hash proves immutability, never quality.
 */
export function sealDataset(
  entries: readonly DatasetEntry[], specs: readonly CompanySpec[],
  identity: { datasetId: string; datasetVersion: string; provenanceClass: string },
): DatasetSeal {
  const serialized = serializeDataset(entries);
  const d = auditDistinctness(specs);
  const c = auditConsistency(entries);
  const r = auditRequiredFields(entries);
  const errorCount = [...d.findings, ...c.findings, ...r.findings].filter((f) => f.severity === 'error').length;

  return {
    datasetId: identity.datasetId,
    datasetVersion: identity.datasetVersion,
    provenanceClass: identity.provenanceClass,
    companyCount: entries.length,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    serializedBytes: Buffer.byteLength(serialized, 'utf8'),
    audits: { distinctness: d.passed, consistency: c.passed, requiredFields: r.passed },
    errorCount,
  };
}
