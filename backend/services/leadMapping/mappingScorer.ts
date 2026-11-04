/**
 * PI-LDB-01 — the deterministic mapping scorer.
 *
 * ─── THE ONE RULE ─────────────────────────────────────────────────────────
 * `scoreCandidate` cannot be influenced by a model's self-assessment,
 * because it has no parameter for one. The model's only input is
 * `modelVoted: boolean` — the FACT that it proposed this target, worth a
 * bounded increment, and nothing more. A number a model produced for its own
 * work measures fluency, and the failure mode is specific and bad: a
 * confidently-worded wrong mapping routes a column of job titles into a
 * company description, silently, for every future import that reuses the
 * approved profile.
 *
 * If a later change wants to use the model's number, it must add the
 * parameter. That is a diff a reviewer can see, which is the point.
 *
 * ─── EIGHT SIGNALS, SIX OF THEM FREE OF THE MODEL ─────────────────────────
 * The weights below are asserted, not calibrated — there is no labelled
 * mapping dataset in this repository yet, and claiming calibration without
 * one would be the same error the scoring programme already records. They are
 * therefore deliberately conservative: the auto-apply floor sits high enough
 * that only an exact synonym match WITH conforming sample values clears it,
 * and everything else goes to a human. Tuning them is a task for after the
 * evaluation set from §C.8 exists.
 */

import type { CanonicalFieldDef } from './canonicalFieldRegistry';
import type { CanonicalDataType, DataTypeCompatibility } from './mappingTypes';
import type { RedactedSample, SampleShape } from './sampleRedaction';

/** Weights, documented so a reader can see what dominates. */
const W = {
  /** Header IS a known synonym. The strongest header-only evidence. */
  exactSynonym: 0.46,
  /** Header shares meaningful tokens with a synonym or the label. */
  tokenOverlap: 0.18,
  /** Header equals the canonical key itself (`jobTitle`, `job_title`). */
  keyMatch: 0.40,
  /** Sample values conform to the destination's type. */
  typeConformance: 0.26,
  /** For enums: how many samples hit an allowed value. */
  enumMatch: 0.20,
  /** This tenant approved this mapping before, for a compatible schema. */
  approvedProfile: 0.50,
  /** The source's own description of the field agrees. */
  descriptionAgreement: 0.10,
  /** The model proposed this target. A vote, not a confidence. */
  modelVote: 0.12,
} as const;

/**
 * The floor for `high_confidence_suggestion`. Set so that header evidence
 * alone cannot reach it: an exact synonym (0.46) plus a model vote (0.12) is
 * 0.58, still short. Conforming sample values (0.26) are required, which
 * means the engine never auto-applies a mapping it has not seen data for.
 */
export const AUTO_APPLY_FLOOR = 0.72;

/** Below this, the column is reported `unmapped` rather than guessed at. */
export const PLAUSIBILITY_FLOOR = 0.22;

export interface ScoreInputs {
  header: string;
  field: CanonicalFieldDef;
  samples: readonly RedactedSample[];
  /** The source's own description for this column, when it supplies one. */
  fieldDescription?: string | null;
  /** A tenant previously approved THIS header → THIS target. */
  approvedInProfile: boolean;
  /**
   * The model proposed this target. A boolean on purpose — see the header.
   */
  modelVoted: boolean;
}

export interface ScoreResult {
  score: number;
  evidence: readonly string[];
  dataTypeCompatibility: DataTypeCompatibility;
}

/** Lowercases, strips punctuation, collapses whitespace. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits into comparable tokens, dropping noise words that carry no meaning. */
const STOP_TOKENS = new Set(['the', 'a', 'of', 'for', 'and', 'or', 'no', 's']);

export function tokenise(text: string): string[] {
  return normaliseHeader(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

/** Singular/plural and spelling-variant folding: `descriptions` → `description`. */
export function fold(token: string): string {
  let t = token;
  if (t.endsWith('ies') && t.length > 4) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith('es') && t.length > 3) t = t.slice(0, -2);
  else if (t.endsWith('s') && t.length > 3) t = t.slice(0, -1);
  // British/American variants that appear in real vendor files.
  t = t.replace(/isation$/, 'ization').replace(/ise$/, 'ize');
  return t;
}

function foldedSet(text: string): Set<string> {
  return new Set(tokenise(text).map(fold));
}

/** Does the destination's type accept these sample shapes? */
export function compatibility(
  dataType: CanonicalDataType,
  samples: readonly RedactedSample[],
  enumValues?: readonly string[],
): DataTypeCompatibility {
  const present = samples.filter((s) => s.shape !== 'empty');
  // No evidence is not the same as bad evidence. An all-empty column tells us
  // nothing, and reporting `incompatible` would let an empty optional column
  // fail a mapping that is perfectly correct.
  if (present.length === 0) return 'unknown';

  const shapes = present.map((s) => s.shape);
  const all = (pred: (s: SampleShape) => boolean) => shapes.every(pred);
  const some = (pred: (s: SampleShape) => boolean) => shapes.some(pred);

  switch (dataType) {
    case 'email':
      return all((s) => s === 'email') ? 'compatible' : 'incompatible';
    case 'phone':
      return all((s) => s === 'phone') ? 'compatible'
        : some((s) => s === 'phone') ? 'coercible' : 'incompatible';
    case 'url':
      return all((s) => s === 'url') ? 'compatible'
        : all((s) => s === 'url' || s === 'domain') ? 'coercible' : 'incompatible';
    case 'domain':
      return all((s) => s === 'domain') ? 'compatible'
        : all((s) => s === 'domain' || s === 'url') ? 'coercible' : 'incompatible';
    case 'integer':
      return all((s) => s === 'integer') ? 'compatible'
        : all((s) => s === 'integer' || s === 'decimal') ? 'coercible'
        // `1,200` and `$1.2M` arrive as short_text and are genuinely parseable,
        // but only a deterministic parser may decide that — not this scorer.
        : all((s) => s === 'short_text') ? 'coercible' : 'incompatible';
    case 'date':
      return all((s) => s === 'date') ? 'compatible'
        : all((s) => s === 'date' || s === 'integer') ? 'coercible' : 'incompatible';
    case 'enum': {
      if (!enumValues || enumValues.length === 0) return 'unknown';
      const allowed = new Set(enumValues.map((v) => v.toLowerCase()));
      const hits = present.filter((s) => allowed.has(s.value.trim().toLowerCase())).length;
      if (hits === present.length) return 'compatible';
      return hits > 0 ? 'coercible' : 'incompatible';
    }
    case 'text[]':
      return all((s) => s === 'short_text' || s === 'long_text') ? 'compatible' : 'coercible';
    case 'text':
      // Text accepts anything EXCEPT a shape that is unmistakably something
      // else. A column of emails is not a job title, and letting `text` claim
      // it would make every text field a magnet for identity columns.
      return some((s) => s === 'email' || s === 'phone') ? 'incompatible' : 'compatible';
  }
}

export function scoreCandidate(inputs: ScoreInputs): ScoreResult {
  const { header, field, samples, fieldDescription, approvedInProfile, modelVoted } = inputs;
  const evidence: string[] = [];
  let score = 0;

  const normHeader = normaliseHeader(header);
  const headerTokens = foldedSet(header);

  // S1 — exact synonym, after folding, so `Descriptions` matches `description`.
  const normSynonyms = field.synonyms.map(normaliseHeader);
  const foldedHeader = [...headerTokens].sort().join(' ');
  const exact =
    normSynonyms.includes(normHeader) ||
    normSynonyms.some((s) => [...foldedSet(s)].sort().join(' ') === foldedHeader);
  if (exact) {
    score += W.exactSynonym;
    evidence.push('exact_synonym');
  }

  // S2 — the canonical key or column itself appears as the header.
  if (!exact && (normHeader === normaliseHeader(field.key) || normHeader === normaliseHeader(field.column))) {
    score += W.keyMatch;
    evidence.push('canonical_key_match');
  }

  // S3 — token overlap with any synonym or the label, scaled by how much of
  // the header is accounted for. A one-token overlap out of four is weak.
  if (!exact) {
    let best = 0;
    for (const candidate of [...field.synonyms, field.label]) {
      const candTokens = foldedSet(candidate);
      if (candTokens.size === 0 || headerTokens.size === 0) continue;
      let shared = 0;
      for (const t of headerTokens) if (candTokens.has(t)) shared += 1;
      best = Math.max(best, shared / Math.max(headerTokens.size, candTokens.size));
    }
    if (best > 0) {
      score += W.tokenOverlap * best;
      evidence.push(`token_overlap:${best.toFixed(2)}`);
    }
  }

  // S4 — do the values fit the destination?
  const compat = compatibility(field.dataType, samples, field.enumValues);
  if (compat === 'compatible') {
    score += W.typeConformance;
    evidence.push('samples_conform');
  } else if (compat === 'coercible') {
    score += W.typeConformance * 0.5;
    evidence.push('samples_coercible');
  } else if (compat === 'incompatible') {
    // A real penalty, not merely an absent bonus: a column of emails must be
    // actively pushed away from `jobTitle`, or header evidence alone wins.
    score -= W.typeConformance;
    evidence.push('samples_incompatible');
  } else {
    evidence.push('samples_absent');
  }

  // S5 — enum hit rate, on top of conformance.
  if (field.dataType === 'enum' && field.enumValues && compat !== 'unknown') {
    const allowed = new Set(field.enumValues.map((v) => v.toLowerCase()));
    const present = samples.filter((s) => s.shape !== 'empty');
    if (present.length > 0) {
      const rate = present.filter((s) => allowed.has(s.value.trim().toLowerCase())).length / present.length;
      if (rate > 0) {
        score += W.enumMatch * rate;
        evidence.push(`enum_match:${rate.toFixed(2)}`);
      }
    }
  }

  // S6 — a decision this tenant already made. Ranks above any fresh guess.
  if (approvedInProfile) {
    score += W.approvedProfile;
    evidence.push('approved_profile');
  }

  // S7 — the source's own description of its field.
  if (fieldDescription && fieldDescription.trim()) {
    const descTokens = foldedSet(fieldDescription);
    const registryTokens = foldedSet(`${field.label} ${field.description}`);
    let shared = 0;
    for (const t of descTokens) if (registryTokens.has(t)) shared += 1;
    if (shared > 0 && descTokens.size > 0) {
      const ratio = shared / descTokens.size;
      score += W.descriptionAgreement * ratio;
      evidence.push(`description_agreement:${ratio.toFixed(2)}`);
    }
  }

  // S8 — the model's vote. A bounded increment for the FACT of the proposal.
  if (modelVoted) {
    score += W.modelVote;
    evidence.push('model_vote');
  }

  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    evidence,
    dataTypeCompatibility: compat,
  };
}
