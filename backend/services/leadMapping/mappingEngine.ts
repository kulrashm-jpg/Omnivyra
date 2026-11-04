/**
 * PI-LDB-01 — the AI semantic attribute mapping engine.
 *
 * ─── WHAT THIS DOES AND DOES NOT DO ───────────────────────────────────────
 * Given a source schema it returns, per column, a proposed canonical
 * destination with the evidence behind it, or a QUESTION for the tenant. It
 * writes nothing, reads no database, and holds no credentials. The proposer
 * is injected, so a unit test runs the whole engine with no network, no API
 * key and no spend — and so the model is one replaceable opinion rather than
 * the engine itself.
 *
 * ─── THE MODEL IS AN UNTRUSTED INPUT ──────────────────────────────────────
 * A proposer's `target` is checked against the registry and DISCARDED if it
 * is not a known key. That is what makes a prompt-injected or hallucinated
 * response harmless: it cannot name a destination that does not exist, it
 * cannot name a column directly, and it cannot raise its own score — its
 * only influence is a bounded vote (`mappingScorer.ts`). A model that
 * returns `{"target": "DROP TABLE users"}` produces exactly the same result
 * as a model that returns nothing.
 *
 * ─── WHY THE DEFAULT IS A QUESTION ────────────────────────────────────────
 * The expensive error here is not an unmapped column, which a tenant fixes in
 * one click. It is a confidently wrong mapping that gets saved as an approved
 * profile and then silently misroutes every later import. So escalation is a
 * CAP applied after scoring: a high score on a polysemous header, or on
 * anything identity-critical, still yields `review_required`.
 */

import { createHash } from 'node:crypto';

import {
  CANONICAL_FIELDS,
  GEOGRAPHY_AMBIGUITY_PAIRS,
  POLYSEMOUS_HEADERS,
  canonicalField,
  isCanonicalFieldKey,
  allowedTargets,
  type CanonicalFieldDef,
  type CanonicalFieldKey,
} from './canonicalFieldRegistry';
import {
  AUTO_APPLY_FLOOR,
  PLAUSIBILITY_FLOOR,
  normaliseHeader,
  scoreCandidate,
} from './mappingScorer';
import {
  assertRedacted,
  redactSamples,
  toProposerSamples,
  type RedactedSample,
} from './sampleRedaction';
import type {
  AmbiguityOption,
  AmbiguityQuestion,
  DegradedField,
  FieldMappingProposal,
  MappingCandidate,
  MappingEngineInput,
  MappingEngineResult,
  MappingProposer,
  ModelEcho,
  ProfileOutcome,
  ProposalFromModel,
} from './mappingTypes';

/**
 * Stable fingerprint of a source schema.
 *
 * Normalised and ORDER-INSENSITIVE: a vendor that reorders its columns has
 * not changed its schema, and forcing a re-review for that would train
 * tenants to click through re-reviews, which is worse than not asking. A
 * header added or removed DOES change it, because that genuinely may change
 * what a column means.
 */
export function fingerprintSchema(headers: readonly string[]): string {
  const normalised = headers.map(normaliseHeader).filter(Boolean).sort();
  return createHash('sha256').update(normalised.join('\u0000')).digest('hex');
}

/** Compares a stored profile against this file's headers. */
function evaluateProfile(input: MappingEngineInput, fingerprint: string): ProfileOutcome | null {
  const profile = input.storedProfile;
  if (!profile) return null;

  const now = new Set(input.headers.map(normaliseHeader));
  const then = new Set(profile.headers.map(normaliseHeader));
  const addedHeaders = [...now].filter((h) => !then.has(h));
  const removedHeaders = [...then].filter((h) => !now.has(h));

  const state: ProfileOutcome['state'] =
    profile.sourceSchemaFingerprint === fingerprint ? 'applied' : 'drifted';

  return { profileId: profile.profileId, version: profile.version, state, addedHeaders, removedHeaders };
}

/** Normalises and validates a proposer's output. Unknown targets are dropped. */
function indexModelProposals(
  raw: readonly ProposalFromModel[],
): Map<string, { targets: Set<CanonicalFieldKey>; echo: ModelEcho; uncertain: boolean }> {
  const byHeader = new Map<string, { targets: Set<CanonicalFieldKey>; echo: ModelEcho; uncertain: boolean }>();

  for (const proposal of raw) {
    if (!proposal || typeof proposal.sourceField !== 'string') continue;
    const key = normaliseHeader(proposal.sourceField);
    if (!key) continue;

    const entry =
      byHeader.get(key) ??
      {
        targets: new Set<CanonicalFieldKey>(),
        echo: {
          selfReportedConfidence:
            typeof proposal.selfReportedConfidence === 'number' ? proposal.selfReportedConfidence : null,
          reasoning: typeof proposal.reasoning === 'string' ? proposal.reasoning.slice(0, 400) : null,
        },
        uncertain: proposal.uncertain === true,
      };

    // Only registry keys survive. This is the containment boundary.
    for (const candidate of [proposal.target, ...(proposal.alternatives ?? [])]) {
      if (typeof candidate === 'string' && isCanonicalFieldKey(candidate)) {
        entry.targets.add(candidate);
      }
    }
    if (proposal.uncertain === true) entry.uncertain = true;
    byHeader.set(key, entry);
  }

  return byHeader;
}

function buildCandidate(field: CanonicalFieldDef, score: number, evidence: readonly string[], compat: MappingCandidate['dataTypeCompatibility']): MappingCandidate {
  return {
    target: field.key,
    entity: field.entity,
    score,
    evidence,
    dataTypeCompatibility: compat,
    transformation: field.defaultTransformation,
  };
}

function optionFor(key: CanonicalFieldKey): AmbiguityOption {
  const field = canonicalField(key);
  return {
    target: key,
    label: field ? `${field.label} (${field.entity === 'contact' ? 'the person' : 'the company'})` : key,
    rationale: field ? field.description : '',
  };
}

const IGNORE_OPTION: AmbiguityOption = {
  target: null,
  label: 'Ignore this column',
  rationale: 'The column is kept with the original record but is not written to any canonical field.',
};

/**
 * Detects the person-vs-employer geography collision.
 *
 * This is not a hypothetical: `ManualLeadInput` states that reusing the
 * person's `countryCode`/`region`/`city` for the employer "would silently
 * overwrite one with the other". A bare `Country` header is therefore
 * undecidable, and the only correct behaviour is to ask.
 */
function geographyAmbiguity(header: string, ranked: readonly MappingCandidate[]): AmbiguityQuestion | null {
  const top = ranked[0];
  if (!top) return null;
  for (const [personKey, companyKey] of GEOGRAPHY_AMBIGUITY_PAIRS) {
    if (top.target !== personKey && top.target !== companyKey) continue;
    // Ask unless the header itself disambiguates (`Company City`, `HQ Country`).
    const norm = normaliseHeader(header);
    const saysCompany = /\b(company|employer|hq|headquarters|office|account|org|organisation|organization)\b/.test(norm);
    const saysPerson = /\b(person|contact|lead|individual|candidate)\b/.test(norm);
    if (saysCompany || saysPerson) return null;
    return {
      reason: 'entity_ambiguous',
      question: `Does "${header}" describe where the PERSON is, or where their COMPANY is based?`,
      options: [optionFor(personKey), optionFor(companyKey), IGNORE_OPTION],
    };
  }
  return null;
}

/** Detects a header whose meaning the header text cannot settle. */
function polysemousAmbiguity(header: string, ranked: readonly MappingCandidate[]): AmbiguityQuestion | null {
  const norm = normaliseHeader(header);
  const declared = POLYSEMOUS_HEADERS[norm];
  if (!declared) return null;

  const options: AmbiguityOption[] = [];
  const seen = new Set<CanonicalFieldKey>();
  for (const key of [...declared, ...ranked.slice(0, 3).map((c) => c.target)]) {
    if (!seen.has(key) && canonicalField(key)) {
      seen.add(key);
      options.push(optionFor(key));
    }
  }
  options.push(IGNORE_OPTION);

  return {
    reason: 'polysemous_header',
    question:
      `"${header}" can mean more than one thing and we will not guess. ` +
      `Which of these does this column hold?`,
    options,
  };
}

/**
 * Detects one column carrying two canonical facts, e.g. `City, Country` or
 * `Name / Title`. Requires BOTH a delimiter in every non-empty sample and a
 * header naming two plausible destinations — either alone is too weak, and a
 * false positive here blocks a perfectly good column.
 */
function compositeAmbiguity(
  header: string,
  samples: readonly RedactedSample[],
  ranked: readonly MappingCandidate[],
): AmbiguityQuestion | null {
  const present = samples.filter((s) => s.shape !== 'empty');
  if (present.length < 2 || ranked.length < 2) return null;

  const delimiters = [',', '|', '/', ' - ', ';'];
  const delimiter = delimiters.find((d) => present.every((s) => s.value.includes(d)));
  if (!delimiter) return null;

  // Two strong, DIFFERENT-entity candidates plus a consistent delimiter is
  // the signature of a combined column.
  const [first, second] = ranked;
  if (first.score < PLAUSIBILITY_FLOOR || second.score < PLAUSIBILITY_FLOOR) return null;
  if (first.entity === second.entity && first.target.toLowerCase().includes(second.target.toLowerCase())) return null;

  return {
    reason: 'composite_field',
    question:
      `"${header}" looks like it holds more than one value per row, separated by "${delimiter.trim()}". ` +
      `Tell us what it contains so we can split it correctly, or ignore it.`,
    options: [optionFor(first.target), optionFor(second.target), IGNORE_OPTION],
  };
}

/**
 * Proposes mappings for one source schema.
 *
 * `proposer` is optional. With none, the engine is purely deterministic —
 * which is also the behaviour when the model call fails, so an AI outage
 * degrades the quality of a suggestion rather than taking the import down.
 */
export async function proposeFieldMappings(
  input: MappingEngineInput,
  proposer?: MappingProposer,
): Promise<MappingEngineResult> {
  const fingerprint = fingerprintSchema(input.headers);
  const profile = evaluateProfile(input, fingerprint);
  const degraded: DegradedField[] = [];

  const redacted = redactSamples(input.samples);
  const proposerSamples = toProposerSamples(redacted);
  // Fails closed rather than trusting the redactor's own output.
  for (const values of Object.values(proposerSamples)) assertRedacted(values);

  let modelIndex = new Map<string, { targets: Set<CanonicalFieldKey>; echo: ModelEcho; uncertain: boolean }>();
  if (proposer) {
    try {
      const raw = await proposer({
        headers: input.headers,
        samples: proposerSamples,
        fieldDescriptions: input.fieldDescriptions,
        allowedTargets: allowedTargets(),
      });
      modelIndex = indexModelProposals(raw ?? []);
    } catch (error) {
      // One degraded entry for the whole call, then carry on deterministically.
      degraded.push({
        sourceField: '*',
        cause: `proposer_unavailable:${error instanceof Error ? error.name : 'unknown'}`,
      });
    }
  }

  // Profile entries, keyed by normalised header.
  const profileEntries = new Map(
    (input.storedProfile?.entries ?? []).map((e) => [normaliseHeader(e.sourceField), e] as const),
  );

  // ── Pass 1: score every header against every destination. ───────────────
  const ranked = new Map<string, MappingCandidate[]>();
  for (const header of input.headers) {
    const norm = normaliseHeader(header);
    const samples = redacted[header] ?? [];
    const model = modelIndex.get(norm);
    const profileEntry = profileEntries.get(norm);

    const candidates: MappingCandidate[] = [];
    for (const field of CANONICAL_FIELDS) {
      const result = scoreCandidate({
        header,
        field,
        samples,
        fieldDescription: input.fieldDescriptions?.[header] ?? null,
        approvedInProfile: profile?.state === 'applied' && profileEntry?.target === field.key,
        modelVoted: model?.targets.has(field.key) === true,
      });
      // ── WHAT IS ALLOWED TO NOMINATE A DESTINATION ──────────────────────
      // A column's NAME identifies where it goes. Its VALUES only corroborate.
      // Type conformance alone must never nominate: `description` is a text
      // field, so "these values are text" would make it a candidate for every
      // text column in every file — and at 0.26 that clears the plausibility
      // floor on its own. A column called `Favourite Colour` would become a
      // proposed company description, and on a column called `Email` holding
      // company names, `description` (0.26, values fit) would outrank `email`
      // (0.46 for the name, minus 0.26 for the mismatch) and the mislabelling
      // would be reported as a weak guess instead of a type failure.
      //
      // So a candidate needs name evidence, a human's prior approval, or a
      // model nomination. Nothing is identified by its values alone.
      const nameEvidence = result.evidence.some(
        (e) => e === 'exact_synonym' || e === 'canonical_key_match' || e.startsWith('token_overlap'),
      );
      const nominated =
        nameEvidence || result.evidence.includes('approved_profile') || result.evidence.includes('model_vote');
      if (!nominated) continue;

      // Among nominated candidates, keep those that clear the floor OR carry
      // unambiguous header evidence. The second clause is what lets a
      // mislabelled column be reported as mislabelled: `email` at 0.20 is
      // below the floor, but "we found nothing" is the wrong answer when the
      // header says exactly what the column was meant to be.
      const strongHeaderEvidence =
        result.evidence.includes('exact_synonym') || result.evidence.includes('canonical_key_match');
      if (result.score >= PLAUSIBILITY_FLOOR || strongHeaderEvidence) {
        candidates.push(buildCandidate(field, result.score, result.evidence, result.dataTypeCompatibility));
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
    ranked.set(header, candidates);
  }

  // ── Pass 2: competing source fields. ────────────────────────────────────
  // Two columns whose best destination is the same field. Neither may apply
  // silently: picking one would drop the other's data with no record of the
  // choice having been made.
  const claimants = new Map<CanonicalFieldKey, string[]>();
  for (const header of input.headers) {
    const top = ranked.get(header)?.[0];
    if (!top) continue;
    const list = claimants.get(top.target) ?? [];
    list.push(header);
    claimants.set(top.target, list);
  }
  const contested = new Set<string>();
  for (const [, headers] of claimants) {
    if (headers.length > 1) for (const h of headers) contested.add(h);
  }

  // ── Pass 3: decide each column. ─────────────────────────────────────────
  const proposals: FieldMappingProposal[] = [];
  for (const header of input.headers) {
    const norm = normaliseHeader(header);
    const candidates = ranked.get(header) ?? [];
    const samples = redacted[header] ?? [];
    const model = modelIndex.get(norm) ?? null;
    const echo: ModelEcho | null = model ? model.echo : null;
    const profileEntry = profileEntries.get(norm);
    const top = candidates[0] ?? null;
    const alternatives = candidates.slice(1, 4);

    // (1) The tenant refused this destination before. Absolute.
    const rejected = input.rejectedTargets?.[header] ?? [];
    if (top && rejected.includes(top.target)) {
      proposals.push({
        sourceField: header,
        status: 'rejected_by_tenant',
        candidate: null,
        alternatives,
        ambiguity: null,
        reasoning: 'You previously declined this mapping, so it is not proposed again.',
        requiresTenantApproval: true,
        provenance: 'refused',
        validation: null,
        model: echo,
      });
      continue;
    }

    // (2) A decision this tenant already made, on a compatible schema.
    if (profile?.state === 'applied' && profileEntry) {
      if (profileEntry.target === null) {
        proposals.push({
          sourceField: header,
          status: 'unmapped',
          candidate: null,
          alternatives: [],
          ambiguity: null,
          reasoning: 'You chose to ignore this column. The original value is still kept with the source record.',
          requiresTenantApproval: false,
          provenance: 'approved_profile',
          validation: null,
          model: echo,
        });
        continue;
      }
      const field = canonicalField(profileEntry.target);
      if (field) {
        const match = candidates.find((c) => c.target === field.key);
        proposals.push({
          sourceField: header,
          status: 'approved_profile_match',
          candidate: match ?? buildCandidate(field, 1, ['approved_profile'], 'unknown'),
          alternatives,
          ambiguity: null,
          reasoning: `Reusing the mapping you approved on ${profileEntry.approvedAt.slice(0, 10)}.`,
          requiresTenantApproval: false,
          provenance: 'approved_profile',
          validation: null,
          model: echo,
        });
        continue;
      }
    }

    // (3) A header we have DECLARED loaded always produces a question, even
    // when nothing scored. `Value` earns no name evidence against any
    // synonym, so it would otherwise fall through as `unmapped` — and
    // "unmapped" invites a tenant to skip past it, whereas the whole reason
    // `Value` is on the polysemous list is that we know the word is loaded
    // and want it answered. A declared ambiguity is a question, not a
    // non-answer. Entries declared with no candidate targets (`status`,
    // `owner`, `notes`) stay unmapped: vague AND nothing to offer.
    const declared = POLYSEMOUS_HEADERS[norm];
    if (!top && declared && declared.length > 0) {
      proposals.push({
        sourceField: header,
        status: 'review_required',
        candidate: null,
        alternatives: [],
        ambiguity: {
          reason: 'polysemous_header',
          question:
            `"${header}" can mean more than one thing and we will not guess. ` +
            `Which of these does this column hold?`,
          options: [...declared.map(optionFor), IGNORE_OPTION],
        },
        reasoning: 'This column name is ambiguous on its own, so we are asking rather than choosing.',
        requiresTenantApproval: true,
        provenance: 'deterministic',
        validation: null,
        model: echo,
      });
      continue;
    }

    // (4) Nothing plausible. The column is preserved, never discarded.
    if (!top) {
      proposals.push({
        sourceField: header,
        status: 'unmapped',
        candidate: null,
        alternatives: [],
        ambiguity: null,
        reasoning:
          'No canonical field matches this column. It is kept with the original record, and you can map it ' +
          'to a field or ignore it.',
        requiresTenantApproval: false,
        provenance: 'deterministic',
        validation: null,
        model: echo,
      });
      continue;
    }

    // (4) The destination is clear but the values do not belong in it.
    if (top.dataTypeCompatibility === 'incompatible') {
      const present = samples.filter((s) => s.shape !== 'empty');
      proposals.push({
        sourceField: header,
        status: 'validation_failed',
        candidate: null,
        alternatives,
        ambiguity: null,
        reasoning:
          `The column name suggests ${canonicalField(top.target)?.label ?? top.target}, but the values in it ` +
          `are not of that kind. Nothing was mapped.`,
        requiresTenantApproval: true,
        provenance: 'deterministic',
        validation: {
          samplesConsidered: present.length,
          samplesFailed: present.length,
          // A rule name. NEVER a failing value: those are the tenant's data.
          failureKind: `expected_${canonicalField(top.target)?.dataType ?? 'unknown'}`,
        },
        model: echo,
      });
      continue;
    }

    // (5) Escalation caps, in order of severity.
    const ambiguity =
      polysemousAmbiguity(header, candidates) ??
      geographyAmbiguity(header, candidates) ??
      compositeAmbiguity(header, samples, candidates) ??
      (contested.has(header)
        ? ({
            reason: 'competing_source_fields',
            question:
              `More than one column in this file looks like ` +
              `${canonicalField(top.target)?.label ?? top.target}. Which one should we use?`,
            options: [optionFor(top.target), ...alternatives.map((a) => optionFor(a.target)), IGNORE_OPTION],
          } satisfies AmbiguityQuestion)
        : null) ??
      (profile?.state === 'drifted'
        ? ({
            reason: 'schema_drift',
            question:
              `This file's columns differ from the ones you approved before, so we are not reusing that ` +
              `mapping without checking. Is "${header}" still ` +
              `${canonicalField(top.target)?.label ?? top.target}?`,
            options: [optionFor(top.target), ...alternatives.map((a) => optionFor(a.target)), IGNORE_OPTION],
          } satisfies AmbiguityQuestion)
        : null) ??
      (canonicalField(top.target)?.identityCritical
        ? ({
            reason: 'identity_critical',
            question:
              `"${header}" would be used to decide who this record IS. Please confirm it is ` +
              `${canonicalField(top.target)?.label ?? top.target}.`,
            options: [optionFor(top.target), ...alternatives.map((a) => optionFor(a.target)), IGNORE_OPTION],
          } satisfies AmbiguityQuestion)
        : null);

    if (ambiguity) {
      proposals.push({
        sourceField: header,
        status: 'review_required',
        candidate: top,
        alternatives,
        ambiguity,
        reasoning: reasoningFor(top, model?.uncertain === true),
        requiresTenantApproval: true,
        provenance: model?.targets.has(top.target) ? 'new_suggestion' : 'deterministic',
        validation: null,
        model: echo,
      });
      continue;
    }

    // (6) Strong enough to apply without asking.
    if (top.score >= AUTO_APPLY_FLOOR) {
      proposals.push({
        sourceField: header,
        status: 'high_confidence_suggestion',
        candidate: top,
        alternatives,
        ambiguity: null,
        reasoning: reasoningFor(top, false),
        requiresTenantApproval: false,
        provenance: model?.targets.has(top.target) ? 'new_suggestion' : 'deterministic',
        validation: null,
        model: echo,
      });
      continue;
    }

    // (7) Plausible but not strong. Default to asking.
    proposals.push({
      sourceField: header,
      status: 'review_required',
      candidate: top,
      alternatives,
      ambiguity: {
        reason: 'polysemous_header',
        question: `Is "${header}" the ${canonicalField(top.target)?.label ?? top.target}?`,
        options: [optionFor(top.target), ...alternatives.map((a) => optionFor(a.target)), IGNORE_OPTION],
      },
      reasoning: reasoningFor(top, model?.uncertain === true),
      requiresTenantApproval: true,
      provenance: model?.targets.has(top.target) ? 'new_suggestion' : 'deterministic',
      validation: null,
      model: echo,
    });
  }

  return {
    sourceSchemaFingerprint: fingerprint,
    proposals,
    requiresReview: proposals.some((p) => p.requiresTenantApproval),
    profile,
    degraded,
  };
}

/**
 * Prose for the tenant. Built from the evidence list, never from a sample
 * value — a reason shown in a UI must not leak the data it reasoned about.
 */
function reasoningFor(candidate: MappingCandidate, modelUncertain: boolean): string {
  const parts: string[] = [];
  if (candidate.evidence.includes('approved_profile')) parts.push('you approved this mapping before');
  if (candidate.evidence.includes('exact_synonym')) parts.push('the column name is a known name for this field');
  if (candidate.evidence.includes('canonical_key_match')) parts.push('the column name matches the field exactly');
  if (candidate.evidence.some((e) => e.startsWith('token_overlap'))) parts.push('the column name partly matches this field');
  if (candidate.evidence.includes('samples_conform')) parts.push('the values are the right kind for it');
  if (candidate.evidence.includes('samples_coercible')) parts.push('the values can be converted to the right kind');
  if (candidate.evidence.includes('samples_absent')) parts.push('this column has no values to check');
  if (candidate.evidence.includes('model_vote')) parts.push('our mapping model also suggested it');
  if (modelUncertain) parts.push('the model flagged its own uncertainty');
  return parts.length ? `Proposed because ${parts.join(', and ')}.` : 'Proposed on the column name alone.';
}
