/**
 * PI-P1-W03 — the ratified-ICP contributor.
 *
 * D1 gave the platform a tenant-owned, versioned, human-ratified ICP and a pure
 * evaluator for it. Nothing connected that evaluator to scoring, so a ratified
 * ICP influenced nothing. This engine is that connection, and deliberately
 * nothing more.
 *
 * ─── IT CALCULATES NOTHING ────────────────────────────────────────────────
 * `evaluateIcpFit` is the single authority for ICP fit. This module derives the
 * subject's facts, calls it, and re-shapes the result into an `EngineOutput`.
 * There is no second formula here, no weighting, no threshold and no default —
 * a second spelling of "how well does this person match" is how one dimension
 * becomes two that disagree.
 *
 * ─── IT PERFORMS NO I/O ───────────────────────────────────────────────────
 * `assembleLeadUnderstanding` is synchronous, and every engine with it. The
 * ratified ICP is read by the caller that builds the context — asynchronously,
 * tenant-scoped, through D1's own `getRatifiedIcp` — and arrives here already
 * resolved on `ctx.ratifiedIcp`. This module touches no database, resolves no
 * tenant and loads nothing.
 *
 * ─── THE DIMENSION ALREADY EXISTS ─────────────────────────────────────────
 * Contributions land on `icp`, which `SCORE_DIMENSIONS` has always contained and
 * which `personaIcp` already emits. `prospectIcp/types.ts` anticipated exactly
 * this: "the contributions land in the dimension that already exists rather than
 * opening a second one". `personaIcp` is untouched; the combiner blends both
 * contributors as it blends any other pair.
 *
 * ─── ABSTENTION IS INHERITED, NOT REIMPLEMENTED ───────────────────────────
 * `evaluateIcpFit` returns ZERO contributions when it abstains — never a `0`,
 * never a `0.5`. `combineDimension` reads an absent contribution as abstention
 * and a zero as a claim. So this engine passes the evaluator's contributions
 * through verbatim: with no ratified ICP the dimension abstains, which is the
 * whole point of contract 18 and the reason `ratified: null` is a first-class
 * input rather than a reason to skip the call.
 */

import { evaluateIcpFit } from '../../prospectIcp/evaluate';
import type { IcpSubjectFacts, RatifiedIcp } from '../../prospectIcp/types';
import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, mkEvidence } from './engineTypes';
import { reasoningTrace } from '../reasoning';

const ENGINE = 'prospect_icp_fit';

/** The person side. Always evaluated — a lead context always describes one. */
const PERSON = 'person' as const;
/** The account side (FR-16). Evaluated ONLY when the context carries account facts. */
const ACCOUNT = 'account' as const;

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Map the lead context onto D1's CLOSED person vocabulary
 * (`job_title`, `department`, `seniority`, `country_code`, `region`, `city`).
 *
 * Only attributes the context genuinely carries are emitted. `ctx.identity`
 * has no country/region/city — `geography` is one free-text field, and turning
 * it into a `country_code` would be inventing an observation. Omitted
 * attributes are reported `unknown` by the evaluator, which is the correct,
 * abstention-friendly answer: a criterion we cannot evaluate is not a criterion
 * we failed.
 */
export function toIcpSubjectFacts(ctx: LeadIntelligenceContext): IcpSubjectFacts {
  const id = ctx.identity ?? {};
  const attributes: Record<string, unknown> = {};

  const jobTitle = text(id.title);
  if (jobTitle) attributes.job_title = jobTitle;

  const department = text(id.department);
  if (department) attributes.department = department;

  const seniority = text(id.seniority);
  if (seniority) attributes.seniority = seniority;

  return { subject: PERSON, attributes, observedAt: text(id.observedAt) ?? null };
}

/**
 * WS-6 (FR-16) — the ACCOUNT subject's facts, when the context carries them.
 *
 * Returns null when it does not, which is the difference between "this
 * prospect has no account" and "this account matches nothing": the first must
 * not be evaluated at all, and the second cannot happen because a missing
 * attribute is `unknown`.
 */
export function toIcpAccountFacts(ctx: LeadIntelligenceContext): IcpSubjectFacts | null {
  const account = ctx.account;
  if (!account) return null;
  return {
    subject: ACCOUNT,
    // Passed through as the Account holds them. Normalisation is the
    // evaluator's, and re-doing it here would be a second spelling of it.
    attributes: { ...account.attributes },
    observedAt: text(account.observedAt) ?? null,
  };
}

/**
 * Evaluate the tenant's ratified ICP against this lead.
 *
 * Always calls the evaluator for the PERSON, including when there is no
 * ratified ICP — the evaluator owns that abstention and reports
 * `no_ratified_icp` for it. The ACCOUNT is evaluated only when the context
 * carries account facts, because there is no account subject to judge
 * otherwise.
 *
 * Two evaluations, one ICP (D1: "They are two evaluations, never two ICPs").
 * Both contributions land on the `icp` dimension the combiner already blends;
 * a separate account dimension would be a second scoring model, and merging
 * the two evaluations before scoring would let a company's fit silently stand
 * in for a person's.
 */
export function runProspectIcpFit(ctx: LeadIntelligenceContext): EngineOutput {
  const out = emptyOutput(ENGINE);

  const ratified: RatifiedIcp | null = ctx.ratifiedIcp ?? null;
  const accountFacts = toIcpAccountFacts(ctx);

  const evaluations = [
    { subject: PERSON, evaluation: evaluateIcpFit({ ratified, facts: toIcpSubjectFacts(ctx), asOf: ctx.asOf }) },
    ...(accountFacts
      ? [{ subject: ACCOUNT, evaluation: evaluateIcpFit({ ratified, facts: accountFacts, asOf: ctx.asOf }) }]
      : []),
  ];

  // Pass every evaluator contribution through verbatim. Empty when abstaining;
  // at most one per subject otherwise. Never synthesised here.
  out.contributions = evaluations.flatMap((e) => [...e.evaluation.contributions]);
  // The engine abstains only when BOTH sides did: one usable verdict is a
  // verdict, and reporting it as an abstention would discard real evidence.
  out.abstained = evaluations.every((e) => e.evaluation.abstained);

  const observedAt = ratified?.ratifiedAt ?? ctx.asOf;
  for (const { subject, evaluation } of evaluations) {
    if (evaluation.abstained) continue;

    // A non-abstaining evaluation carries its own evidence. Re-key it into the
    // engine's evidence shape so the assembly can dedupe it like any other.
    const value = evaluation.contributions[0]?.value ?? null;
    const evidence = mkEvidence(ENGINE, {
      // The subject is part of the label so person fit and account fit stay
      // distinguishable in the evidence trail rather than reading as one claim.
      label: subject === PERSON ? 'ratified_icp_fit' : `ratified_icp_fit:${subject}`,
      value,
      source: `prospect_icp:${ratified?.icpKey ?? 'unknown'}@v${ratified?.version ?? 0}`,
      observedAt,
      kind: 'structured',
    });
    out.evidence.push(evidence);

    out.reasoning.push(reasoningTrace({
      claim: subject === PERSON ? 'ratified_icp_fit' : `ratified_icp_fit:${subject}`,
      conclusion: value,
      because: [evidence],
      confidence: evaluation.contributions[0]?.confidence ?? 0,
      method: 'deterministic',
    }));
  }

  return out;
}
