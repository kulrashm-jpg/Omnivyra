/**
 * A1 — the translation layer of the AI ICP Generator.
 *
 * Turns raw model output into a proposal that satisfies the FROZEN contracts,
 * or refuses. PURE: no database, no network, no clock, no model call.
 *
 * ─── THIS MODULE TRUSTS NOTHING ───────────────────────────────────────────
 * The prompt states the contract; this file enforces it. Every value is
 * re-derived or re-checked here, and the rules are one-directional: a
 * non-conforming element is DROPPED WITH A REASON, never repaired into
 * something plausible. Repairing model output is how a fabricated criterion
 * ends up inside an immutable ratified document.
 *
 * ─── THE TITLE SHORTLIST IS ONE CRITERION ─────────────────────────────────
 * The evaluator computes `satisfied / evaluable`, so five ranked titles emitted
 * as five criteria would score a person matching one of them at 0.2. The ranked
 * list therefore becomes a SINGLE `job_title one_of` criterion carrying the
 * union of titles, and the ranking lives in proposal metadata where it has no
 * effect on scoring. This is structural here: the translator can only ever
 * build one job_title criterion.
 *
 * ─── CONFIDENCE CANNOT CONTRADICT ITSELF ──────────────────────────────────
 * The model is never asked for `factors.c`. It is derived from `confidence` via
 * the frozen multiplier, so a proposal asserting `low` confidence with a x1.0
 * multiplier cannot be produced at all.
 */

import {
  ICP_CONFIDENCE_LEVELS, ICP_CONFIDENCE_MULTIPLIER, ICP_ORG_STAGES,
  ICP_TARGET_DERIVATIONS, ICP_TARGET_ROLE_TYPES,
  type IcpConfidenceLevel, type IcpCriterion, type IcpProposal,
} from '../types';
import { attributesFor, validateCriteria } from '../criteria';
import { validateProposalTargets } from '../proposalTargets';
import { UNREPRESENTABLE_CONCEPTS, type UnrepresentableConcept } from './prompt';
import type { ProfileEvidence } from './evidence';

/** Person attributes a criterion may name. See prompt.ts for why the rest are out. */
const PROPOSABLE_PERSON_ATTRIBUTES = new Set(['job_title', 'department', 'country_code', 'region', 'city']);
const REFUSED_PERSON_ATTRIBUTES = new Set(['seniority', 'authority', 'influence', 'buying_role']);

/** Stable criterion ids, so two generations of the same shape diff cleanly. */
export const TITLE_UNION_CRITERION_ID = 'person-title-union';
export const DEPARTMENT_CRITERION_ID = 'person-department';

export interface TranslationDiagnostics {
  /** Elements refused, each with the rule that refused it. Never silent. */
  readonly dropped: readonly string[];
  /** Concepts the frozen surface cannot express, with what the model concluded. */
  readonly unrepresentable: readonly { concept: UnrepresentableConcept; finding: string }[];
}

export interface TranslationResult {
  readonly criteria: IcpCriterion[];
  readonly proposal: IcpProposal;
  readonly diagnostics: TranslationDiagnostics;
}

export interface TranslationContext {
  readonly evidence: ProfileEvidence;
  /** Provider/model identity, recorded for audit. */
  readonly model: string;
  readonly provider: string;
  readonly reasoningTraceId: string;
  readonly promptTemplate: string;
  readonly promptVersion: string;
  readonly generatedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
};

const stringsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(text).filter((s): s is string => s !== null);

const confidenceOf = (v: unknown): IcpConfidenceLevel | null => {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (ICP_CONFIDENCE_LEVELS as readonly string[]).includes(c) ? (c as IcpConfidenceLevel) : null;
};

/**
 * Keep only evidence fields that actually carried a value on this profile. A
 * citation to a field the model never saw is not a citation.
 */
const citableFields = (v: unknown, evidence: ProfileEvidence): string[] =>
  stringsOf(v).filter((f) => f in evidence.present);

/**
 * Keep only quotes that appear VERBATIM in the evidence. Whitespace is
 * normalised on both sides because the prompt renders it normalised; nothing
 * else is forgiven. An unverifiable quote is a fabrication signal, and the
 * caller downgrades the claim rather than publishing it.
 */
function verifiedQuotes(v: unknown, evidence: ProfileEvidence): { kept: string[]; rejected: string[] } {
  const haystack = Object.values(evidence.present).join('\n').toLowerCase();
  const kept: string[] = []; const rejected: string[] = [];
  for (const q of stringsOf(v)) {
    if (haystack.includes(q.toLowerCase())) kept.push(q);
    else rejected.push(q);
  }
  return { kept, rejected };
}

/** Numeric predicate operands, validated rather than coerced. */
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

function buildAccountCriterion(
  raw: unknown, evidence: ProfileEvidence, dropped: string[],
): IcpCriterion | null {
  if (!isRecord(raw)) { dropped.push('account criterion: not an object'); return null; }

  const attribute = text(raw.attribute);
  if (!attribute) { dropped.push('account criterion: no attribute'); return null; }
  if (!attributesFor('account').includes(attribute)) {
    dropped.push(`account.${attribute}: not an account attribute the platform stores`);
    return null;
  }

  // §5: no criterion without traceable support.
  const evidenceFields = citableFields(raw.evidenceFields, evidence);
  if (!evidenceFields.length) {
    dropped.push(`account.${attribute}: cites no field that carries a value on this profile`);
    return null;
  }

  const op = text(raw.op);
  let predicate: IcpCriterion['predicate'] | null = null;
  if (op === 'one_of' || op === 'includes_any' || op === 'includes_all') {
    const values = stringsOf(raw.values);
    if (!values.length) { dropped.push(`account.${attribute}: empty value set`); return null; }
    predicate = { op, values } as IcpCriterion['predicate'];
  } else if (op === 'between') {
    const min = num(raw.min); const max = num(raw.max);
    if (min === null || max === null) { dropped.push(`account.${attribute}: between needs numeric min and max`); return null; }
    predicate = { op: 'between', min, max };
  } else if (op === 'at_least' || op === 'at_most') {
    const value = num(raw.value);
    if (value === null) { dropped.push(`account.${attribute}: ${op} needs a numeric value`); return null; }
    predicate = { op, value };
  } else {
    dropped.push(`account.${attribute}: unsupported predicate '${String(op)}'`);
    return null;
  }

  const kind = raw.kind === 'required' || raw.kind === 'optional' ? raw.kind : 'optional';
  const rationale = text(raw.rationale);
  return {
    id: `account-${attribute}`,
    kind,
    subject: 'account',
    attribute,
    predicate,
    description: rationale ? `${rationale} [evidence: ${evidenceFields.join(', ')}]` : null,
  };
}

/**
 * The ranked shortlist, validated. Returns targets in the frozen shape; the
 * caller derives the union criterion from their titles.
 */
function buildTargets(
  raw: unknown, evidence: ProfileEvidence, dropped: string[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seenTitle = new Set<string>();

  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) { dropped.push('target: not an object'); continue; }

    const title = text(item.title);
    if (!title) { dropped.push('target: no title'); continue; }
    if (seenTitle.has(title.toLowerCase())) { dropped.push(`target '${title}': duplicate title`); continue; }

    const attribute = text(item.attribute);
    if (attribute && REFUSED_PERSON_ATTRIBUTES.has(attribute)) {
      dropped.push(`target '${title}': names ${attribute}, which no source can populate (GAP-3)`);
      continue;
    }

    const confidence = confidenceOf(item.confidence);
    if (!confidence) { dropped.push(`target '${title}': confidence outside high|medium|low`); continue; }

    const evidenceFields = citableFields(item.evidenceFields, evidence);
    if (!evidenceFields.length) {
      dropped.push(`target '${title}': cites no field that carries a value on this profile`);
      continue;
    }

    const roleTypes = stringsOf(item.roleTypes)
      .map((r) => r.trim().toLowerCase())
      .filter((r) => (ICP_TARGET_ROLE_TYPES as readonly string[]).includes(r));
    if (!roleTypes.length) { dropped.push(`target '${title}': no recognised role type`); continue; }

    const quotes = verifiedQuotes(item.evidenceQuotes, evidence);
    for (const q of quotes.rejected) {
      dropped.push(`target '${title}': quote not found verbatim in the evidence, discarded — "${q.slice(0, 60)}"`);
    }

    // A claim of DIRECT evidence with no verifiable quote is downgraded, not
    // published. The model does not get to assert observation.
    let derivation = text(item.derivation) ?? 'inferred';
    if (!(ICP_TARGET_DERIVATIONS as readonly string[]).includes(derivation)) derivation = 'inferred';
    if (derivation === 'directly_evidenced' && quotes.kept.length === 0) {
      derivation = 'inferred';
      dropped.push(`target '${title}': claimed direct evidence with no verifiable quote, recorded as inferred`);
    }

    const f = isRecord(item.factors) ? item.factors : {};
    const score = (k: string): number => {
      const v = f[k];
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2 ? v : 0;
    };
    const e = score('e');
    if (e === 0) { dropped.push(`target '${title}': evidence factor 0 is a hard exclusion, not a target`); continue; }

    const orgAssumption = text(item.orgAssumption)
      ?? `Role assumed to exist at the proposed target-company stage; derived from ${evidenceFields.join(', ')}.`;

    out.push({
      rank: out.length + 1,                        // re-ranked densely; model gaps are not honoured
      title,
      roleTypes: [...new Set(roleTypes)],
      derivation,
      confidence,
      evidenceFields,
      evidenceQuotes: quotes.kept,
      orgAssumption,
      // `c` is DERIVED, never taken from the model — see the header.
      factors: { e, p: score('p'), b: score('b'), f: score('f'), r: score('r'), c: ICP_CONFIDENCE_MULTIPLIER[confidence] },
    });
    seenTitle.add(title.toLowerCase());
  }
  return out;
}

function buildRejected(raw: unknown, dropped: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    const title = text(item.title);
    const reason = text(item.reason);
    if (!title || !reason) { dropped.push('rejection: needs both a candidate and a reason'); continue; }
    out.push({ title, reason });
  }
  return out;
}

function buildUnrepresentable(
  raw: unknown,
): { concept: UnrepresentableConcept; finding: string }[] {
  const out: { concept: UnrepresentableConcept; finding: string }[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    const concept = text(item.concept)?.toLowerCase();
    const finding = text(item.finding);
    if (!concept || !finding) continue;
    if (!(UNREPRESENTABLE_CONCEPTS as readonly string[]).includes(concept)) continue;
    out.push({ concept: concept as UnrepresentableConcept, finding });
  }
  return out;
}

/**
 * Translate one model response into frozen criteria plus a frozen proposal.
 *
 * @throws IcpContractError from `validateCriteria` / `validateProposalTargets`
 *         if anything that survived translation is still non-conforming. That
 *         is deliberate: the caller must not persist a partly-valid proposal.
 */
export function translateModelOutput(raw: unknown, ctx: TranslationContext): TranslationResult {
  const dropped: string[] = [];
  if (!isRecord(raw)) {
    return {
      criteria: [],
      proposal: { status: 'ai_suggested', ai_value: null, guidance: 'The model returned no usable object.' },
      diagnostics: { dropped: ['model output was not an object'], unrepresentable: [] },
    };
  }

  const criteria: IcpCriterion[] = [];

  for (const item of Array.isArray(raw.account) ? raw.account : []) {
    const c = buildAccountCriterion(item, ctx.evidence, dropped);
    if (c) criteria.push(c);
  }

  const targets = buildTargets(raw.targets, ctx.evidence, dropped);

  // ONE union criterion for the whole shortlist. Never one per target.
  if (targets.length) {
    criteria.push({
      id: TITLE_UNION_CRITERION_ID,
      kind: 'required',
      subject: 'person',
      attribute: 'job_title',
      predicate: { op: 'one_of', values: targets.map((t) => String(t.title)) },
      description:
        `Union of the ${targets.length} ranked target title(s). Ranking and provenance are held in `
        + 'proposal metadata and have no effect on scoring.',
    });
  }

  // At most one department criterion, optional so a blank department never penalises.
  if (isRecord(raw.department)) {
    const values = stringsOf(raw.department.values);
    const fields = citableFields(raw.department.evidenceFields, ctx.evidence);
    if (values.length && fields.length) {
      criteria.push({
        id: DEPARTMENT_CRITERION_ID,
        kind: 'optional',
        subject: 'person',
        attribute: 'department',
        predicate: { op: 'one_of', values },
        description: `Function check, secondary to title. [evidence: ${fields.join(', ')}]`,
      });
    } else if (values.length) {
      dropped.push('department: cites no field that carries a value on this profile');
    }
  }

  // Refuse any person attribute the platform cannot populate, wherever it appears.
  for (const item of Array.isArray(raw.person) ? raw.person : []) {
    const attr = isRecord(item) ? text(item.attribute) : null;
    if (attr && REFUSED_PERSON_ATTRIBUTES.has(attr)) {
      dropped.push(`person.${attr}: no source can populate it, so it would evaluate permanently unknown (GAP-3)`);
    } else if (attr && !PROPOSABLE_PERSON_ATTRIBUTES.has(attr)) {
      dropped.push(`person.${attr}: not a proposable person attribute`);
    }
  }

  const rejected = buildRejected(raw.rejected, dropped);
  const unrepresentable = buildUnrepresentable(raw.unrepresentable);

  // Stage assumption, only when the model named a stage in the frozen vocabulary.
  let stageAssumption: Record<string, unknown> | undefined;
  if (isRecord(raw.stageAssumption)) {
    const stage = text(raw.stageAssumption.stage)?.toLowerCase();
    if (stage && (ICP_ORG_STAGES as readonly string[]).includes(stage)) {
      stageAssumption = {
        stage,
        evidenceFields: citableFields(raw.stageAssumption.evidenceFields, ctx.evidence),
        rationale: text(raw.stageAssumption.rationale),
      };
    } else if (stage) {
      dropped.push(`stageAssumption: '${stage}' is not a recognised stage`);
    }
  }

  // Contract 2 enforcement. Throws rather than persisting a partial proposal.
  const validated = validateProposalTargets({ targets, rejected, stageAssumption });

  const guidance = [
    'AI proposal — review and edit before ratifying. Matching on job_title is EXACT and case-sensitive.',
    unrepresentable.length
      ? `Not expressible as criteria, recorded for the reviewer: ${unrepresentable.map((u) => `${u.concept} — ${u.finding}`).join(' | ')}`
      : null,
    dropped.length ? `Refused during translation (${dropped.length}): ${dropped.join(' | ')}` : null,
  ].filter(Boolean).join('\n');

  const proposal: IcpProposal = {
    status: 'ai_suggested',
    ai_value: [
      `Generated ${ctx.generatedAt} by ${ctx.provider}/${ctx.model}`,
      `prompt ${ctx.promptTemplate}@${ctx.promptVersion}`,
      `trace ${ctx.reasoningTraceId}`,
      `from ${ctx.evidence.presentCount} Company Profile field(s): ${Object.keys(ctx.evidence.present).join(', ')}`,
    ].join(' · '),
    guidance,
    updated_at: ctx.generatedAt,
    targets: validated.targets,
    rejected: validated.rejected,
    ...(validated.stageAssumption ? { stageAssumption: validated.stageAssumption } : {}),
  };

  return {
    // Contract 1 enforcement. Throws on anything non-conforming.
    criteria: validateCriteria(criteria),
    proposal,
    diagnostics: { dropped, unrepresentable },
  };
}
