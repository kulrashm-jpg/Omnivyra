/**
 * AI-visibility OBSERVATIONS — one record per provider × query × run ATTEMPT.
 *
 * Phase B (Agent 2). Additive to the P0 probe contract: `CitationMention` stays
 * the scoring unit and is untouched; a `VisibilityObservation` records what
 * happened on each attempt (completed, failed, skipped), with whom the answer
 * named, so that repeated runs and competitor presence can be reported with
 * their sample sizes.
 *
 * RULES (approved contract, `01-phase-b-contracts.md`):
 *  • Nothing here feeds a dimension, pillar or overall score.
 *  • Failed / skipped attempts carry `appeared: null` and are never in a rate
 *    denominator. Missing evidence is `null` plus a reason, never 0.
 *  • The answer is stored as SHA-256 + an excerpt of ≤ 240 chars. Full text is
 *    held only in process memory, beside the adapter's own answer cache, so a
 *    cache hit can be re-read for entities; it never enters a report.
 *  • Competitors come ONLY from the list the matrix receives. A cited host that
 *    is neither the company nor a known competitor is `unverified` and never
 *    counted. No name is extracted from free text.
 *  • "Answer order" is the order of FIRST APPEARANCE in the answer text. It is
 *    not a rank and must never be labelled one.
 *  • Sentiment is deferred (no classifier is applied).
 */
import { createHash } from 'crypto';
import type { AIProviderId, AIQueryClass, CitationMention } from './providerInterfaces';
import type { ErrorClass } from './publicResearch/providerErrors';
import type { ScoreState } from '../snapshotReport/canonicalScoreState';
import { normalizeIdentityDomain, probeIdentityFingerprint } from './aiVisibilityGrounding';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ObservationCollectionStatus =
  /** The provider returned an answer (it may still be ungrounded). */
  | 'completed'
  /** The provider errored or timed out. */
  | 'failed'
  /** The scan budget refused the call (or ran out before it). */
  | 'skipped_budget'
  /** The local rate limiter refused the call. */
  | 'skipped_rate_limit';

export type KnownCompetitor = { name: string; domain?: string | null };

export type DetectedEntity = {
  /** Canonical label: the company's brand, or the competitor name as listed. */
  name: string;
  role: 'subject' | 'known_competitor';
  /** Verbatim substring of the answer; null when matched on a cited source only. */
  matched_text: string | null;
  /** Char offset of the first match in the answer; null when cited-source only. */
  first_offset: number | null;
  /** 1-based order of first appearance among entities found IN THE TEXT. Not a rank. */
  mention_order: number | null;
  match_basis: 'brand_name' | 'domain' | 'competitor_name' | 'competitor_domain' | 'cited_source_host';
};

export type VisibilityObservation = {
  /** sha256(provider, query_class, query, identity fingerprint, run_index, observed_at). */
  observation_id: string;
  provider: AIProviderId;
  model: string | null;
  retrieval_grounded: boolean;
  query: string;
  query_class: AIQueryClass;
  run_index: number;
  /** Whose visibility this is. */
  subject: { brand_name: string | null; domain: string | null; fingerprint: string };
  collection_status: ObservationCollectionStatus;
  /** Only for failed / skipped attempts. Reuses the provider-error vocabulary. */
  error_class: ErrorClass | null;
  error_reason: string | null;
  /** True when the answer came from the adapter's answer cache (not a new call). */
  cache_hit: boolean;
  /** null on any attempt that did not complete. */
  appeared: boolean | null;
  prominence: number | null;
  citation_corroborated: boolean | null;
  /** Copied verbatim from the provider response. Never synthesised. */
  grounded_sources: string[];
  answer_ref: { sha256: string; length_chars: number; excerpt: string | null } | null;
  entities: DetectedEntity[];
  /** The company's order of first appearance in the text; null when not named. Not a rank. */
  subject_mention_order: number | null;
  /** Cited hosts that are neither the company nor a known competitor. Never counted. */
  unverified_source_hosts: string[];
  observed_at: string;
};

// ── In-memory answer memo (beside the adapter cache, never persisted) ────────

type AnswerMemo = { answer: string; model: string | null };
const answerMemo = new WeakMap<CitationMention, AnswerMemo>();

/** Remember the answer behind a freshly produced mention (same object the cache stores). */
export function rememberAnswer(mention: CitationMention, answer: string, model: string | null): void {
  answerMemo.set(mention, { answer, model });
}

/** The answer behind a (possibly cached) mention, while that mention is alive. */
export function recallAnswer(mention: CitationMention): AnswerMemo | null {
  return answerMemo.get(mention) ?? null;
}

// ── Run-count bounds ─────────────────────────────────────────────────────────

export const GROUNDED_RUNS_MIN = 1;
export const GROUNDED_RUNS_MAX = 5;

/** Clamp a requested run count to [1, 5]; anything not a finite number is 1. */
export function clampGroundedRuns(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : GROUNDED_RUNS_MIN;
  return Math.min(GROUNDED_RUNS_MAX, Math.max(GROUNDED_RUNS_MIN, v));
}

// ── Entity matching (known list only) ─────────────────────────────────────────
// Same token-edge rules as `citationExtractor.ts` (P0); duplicated as constants
// because that file is outside this change's ownership.
const BRAND_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const BRAND_EDGE_AFTER = String.raw`(?![\p{L}\p{N}_])`;
const DOMAIN_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_-])`;
const DOMAIN_EDGE_AFTER = String.raw`(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])`;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Competitor labels too short or too generic to match by name alone (domain still matches). */
const GENERIC_NAMES = new Set(['the', 'and', 'inc', 'ltd', 'llc', 'app', 'apps', 'cloud', 'software', 'platform', 'tools', 'group', 'company', 'solutions']);

function nameMatchable(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.length >= 3 && !GENERIC_NAMES.has(n);
}

function firstMatch(answer: string, text: string, kind: 'name' | 'domain'): { offset: number; matched: string } | null {
  if (!text) return null;
  const re = kind === 'name'
    ? new RegExp(`${BRAND_EDGE_BEFORE}${escapeRegex(text)}${BRAND_EDGE_AFTER}`, 'iu')
    : new RegExp(`${DOMAIN_EDGE_BEFORE}${escapeRegex(text)}${DOMAIN_EDGE_AFTER}`, 'iu');
  const m = answer.match(re);
  return m && typeof m.index === 'number' ? { offset: m.index, matched: m[0] } : null;
}

/** Bare host of a URL (or host-like string); null when it does not parse. */
export function sourceHost(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

const hostIs = (host: string, target: string) => host === target || host.endsWith(`.${target}`);

/**
 * Entities named in one answer: the company plus KNOWN competitors only.
 * Order = first appearance in the text (ties: longer match first, then name).
 */
export function extractAnswerEntities(params: {
  answer: string;
  groundedSources: readonly string[];
  brandName: string | null;
  domain: string | null;
  knownCompetitors?: readonly KnownCompetitor[];
}): { entities: DetectedEntity[]; subject_mention_order: number | null; unverified_source_hosts: string[] } {
  const answer = params.answer ?? '';
  const subjectHost = normalizeIdentityDomain(params.domain);
  const brand = (params.brandName ?? '').trim();
  const found: DetectedEntity[] = [];

  // Subject: brand first, then domain — the same preference as extractCitation.
  const brandHit = brand ? firstMatch(answer, brand, 'name') : null;
  const domainHit = subjectHost ? firstMatch(answer, subjectHost, 'domain') : null;
  const subjectHit = brandHit && (!domainHit || brandHit.offset <= domainHit.offset) ? { ...brandHit, basis: 'brand_name' as const }
    : domainHit ? { ...domainHit, basis: 'domain' as const } : brandHit ? { ...brandHit, basis: 'brand_name' as const } : null;
  if (subjectHit) {
    found.push({ name: brand || subjectHost || '', role: 'subject', matched_text: subjectHit.matched, first_offset: subjectHit.offset, mention_order: null, match_basis: subjectHit.basis });
  }

  const hosts = [...new Set(params.groundedSources.map(sourceHost).filter((h): h is string => Boolean(h)))];
  const claimedHosts = new Set<string>();
  if (subjectHost) hosts.filter((h) => hostIs(h, subjectHost)).forEach((h) => claimedHosts.add(h));

  const seen = new Set<string>();
  for (const c of params.knownCompetitors ?? []) {
    const name = (c?.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || key === brand.toLowerCase()) continue;
    seen.add(key);
    const cHost = normalizeIdentityDomain(c.domain ?? null);
    if (cHost && subjectHost && cHost === subjectHost) continue; // the company is never its own competitor
    const nameHit = nameMatchable(name) ? firstMatch(answer, name, 'name') : null;
    const cDomainHit = cHost ? firstMatch(answer, cHost, 'domain') : null;
    const textHit = nameHit && (!cDomainHit || nameHit.offset <= cDomainHit.offset) ? { ...nameHit, basis: 'competitor_name' as const }
      : cDomainHit ? { ...cDomainHit, basis: 'competitor_domain' as const } : null;
    const citedHosts = cHost ? hosts.filter((h) => hostIs(h, cHost)) : [];
    citedHosts.forEach((h) => claimedHosts.add(h));
    if (textHit) {
      found.push({ name, role: 'known_competitor', matched_text: textHit.matched, first_offset: textHit.offset, mention_order: null, match_basis: textHit.basis });
    } else if (citedHosts.length > 0) {
      found.push({ name, role: 'known_competitor', matched_text: null, first_offset: null, mention_order: null, match_basis: 'cited_source_host' });
    }
  }

  const inText = found.filter((e) => e.first_offset !== null)
    .sort((a, b) => (a.first_offset! - b.first_offset!) || ((b.matched_text?.length ?? 0) - (a.matched_text?.length ?? 0)) || a.name.localeCompare(b.name));
  inText.forEach((e, i) => { e.mention_order = i + 1; });
  const entities = [...inText, ...found.filter((e) => e.first_offset === null)];
  const subject = entities.find((e) => e.role === 'subject');
  return {
    entities,
    subject_mention_order: subject?.mention_order ?? null,
    unverified_source_hosts: hosts.filter((h) => !claimedHosts.has(h)),
  };
}

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Map an adapter error onto the shared provider-error vocabulary.
 *
 * Reads the error's `name` / `reason` rather than `instanceof`, so it never
 * depends on the runtime identity of `productionPrimitives` (several suites
 * replace that module wholesale) and can never itself throw.
 */
export function errorClassFromError(error: unknown): ErrorClass {
  const e = (error && typeof error === 'object' ? error : {}) as { name?: unknown; reason?: unknown };
  if (e.name === 'TimeoutError') return 'provider_unavailable';
  if (e.name === 'HardFailureError') {
    switch (e.reason) {
      case 'auth_failure': return 'invalid_credential';
      case 'quota_exceeded': return 'quota_exhausted';
      case 'rate_limited': return 'rate_limited';
      case 'upstream_error': return 'provider_unavailable';
      case 'governor_blocked': return 'permission_denied';
      default: return 'request_failed';
    }
  }
  return 'request_failed';
}

// ── Observation construction ─────────────────────────────────────────────────

export function observationId(parts: {
  provider: string; query_class: string; query: string; fingerprint: string; run_index: number; observed_at: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([parts.provider, parts.query_class, parts.query, parts.fingerprint, parts.run_index, parts.observed_at]))
    .digest('hex');
}

const excerptOf = (answer: string) => {
  const s = answer.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
};

type ObservationBase = {
  provider: AIProviderId;
  retrievalGrounded: boolean;
  query: string;
  queryClass: AIQueryClass;
  runIndex: number;
  brandName: string;
  domain: string | null;
};

function subjectOf(b: ObservationBase) {
  return {
    brand_name: b.brandName.length > 0 ? b.brandName : null,
    domain: b.domain,
    fingerprint: probeIdentityFingerprint({ brandName: b.brandName, domain: b.domain }),
  };
}

/** A completed attempt (fresh call or cache hit). */
export function completedObservation(b: ObservationBase & {
  mention: CitationMention;
  cacheHit: boolean;
  knownCompetitors?: readonly KnownCompetitor[];
}): VisibilityObservation {
  const subject = subjectOf(b);
  const memo = recallAnswer(b.mention);
  const answer = memo?.answer ?? null;
  const ent = answer !== null
    ? extractAnswerEntities({ answer, groundedSources: b.mention.grounded_sources, brandName: b.brandName, domain: b.domain, knownCompetitors: b.knownCompetitors })
    : { entities: [], subject_mention_order: null, unverified_source_hosts: [] };
  return {
    observation_id: observationId({ provider: b.provider, query_class: b.queryClass, query: b.query, fingerprint: subject.fingerprint, run_index: b.runIndex, observed_at: b.mention.observed_at }),
    provider: b.provider,
    model: memo?.model ?? null,
    retrieval_grounded: b.retrievalGrounded,
    query: b.query,
    query_class: b.queryClass,
    run_index: b.runIndex,
    subject,
    collection_status: 'completed',
    error_class: null,
    error_reason: null,
    cache_hit: b.cacheHit,
    appeared: b.mention.appeared,
    prominence: b.mention.prominence,
    citation_corroborated: b.mention.citation_corroborated,
    grounded_sources: [...b.mention.grounded_sources],
    answer_ref: answer !== null
      ? { sha256: createHash('sha256').update(answer).digest('hex'), length_chars: answer.length, excerpt: b.mention.evidence_excerpt ?? excerptOf(answer) }
      : null,
    entities: ent.entities,
    subject_mention_order: ent.subject_mention_order,
    unverified_source_hosts: ent.unverified_source_hosts,
    observed_at: b.mention.observed_at,
  };
}

/** A failed or skipped attempt: no answer, no `appeared`, excluded from every rate. */
export function unansweredObservation(b: ObservationBase & {
  status: Exclude<ObservationCollectionStatus, 'completed'>;
  errorClass: ErrorClass | null;
  reason: string | null;
  observedAt?: string;
}): VisibilityObservation {
  const subject = subjectOf(b);
  const observedAt = b.observedAt ?? new Date().toISOString();
  return {
    observation_id: observationId({ provider: b.provider, query_class: b.queryClass, query: b.query, fingerprint: subject.fingerprint, run_index: b.runIndex, observed_at: observedAt }),
    provider: b.provider,
    model: null,
    retrieval_grounded: b.retrievalGrounded,
    query: b.query,
    query_class: b.queryClass,
    run_index: b.runIndex,
    subject,
    collection_status: b.status,
    error_class: b.errorClass,
    error_reason: b.reason,
    cache_hit: false,
    appeared: null,
    prominence: null,
    citation_corroborated: null,
    grounded_sources: [],
    answer_ref: null,
    entities: [],
    subject_mention_order: null,
    unverified_source_hosts: [],
    observed_at: observedAt,
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/** A completed, retrieval-grounded answer that returned at least one source. */
export function isValidGroundedObservation(o: VisibilityObservation): boolean {
  return o.collection_status === 'completed' && o.retrieval_grounded && o.grounded_sources.length > 0 && o.appeared !== null;
}

export type MentionRate = { value: number | null; numerator: number; n: number; reason: string | null };

/** appeared / completed grounded-sourced answers. Failed / skipped never count. */
export function mentionRate(observations: readonly VisibilityObservation[]): MentionRate {
  const valid = observations.filter(isValidGroundedObservation);
  const numerator = valid.filter((o) => o.appeared === true).length;
  if (valid.length === 0) {
    return { value: null, numerator: 0, n: 0, reason: 'No completed answer from a retrieval-grounded engine returned sources, so no mention rate exists.' };
  }
  return { value: Number((numerator / valid.length).toFixed(3)), numerator, n: valid.length, reason: null };
}

/** Minimum valid answers before a share of voice is shown (= HIGH_EVIDENCE_THRESHOLD in canonicalScoreState.ts). */
export const SHARE_OF_VOICE_MIN_ANSWERS = 4;

export type ShareOfVoice = { value: number | null; subject_mentions: number; competitor_mentions: number; n: number; reason: string | null };

export function shareOfVoice(observations: readonly VisibilityObservation[], knownCompetitors: readonly KnownCompetitor[]): ShareOfVoice {
  const valid = observations.filter(isValidGroundedObservation);
  const empty = (reason: string): ShareOfVoice => ({ value: null, subject_mentions: 0, competitor_mentions: 0, n: valid.length, reason });
  if (knownCompetitors.filter((c) => (c?.name ?? '').trim()).length === 0) return empty('No known competitor list was supplied, so share of voice cannot be computed.');
  if (valid.length < SHARE_OF_VOICE_MIN_ANSWERS) {
    return empty(`Only ${valid.length} valid grounded answer(s); at least ${SHARE_OF_VOICE_MIN_ANSWERS} are required for share of voice.`);
  }
  const subject = valid.filter((o) => o.entities.some((e) => e.role === 'subject')).length;
  const competitors = valid.reduce((sum, o) => sum + o.entities.filter((e) => e.role === 'known_competitor').length, 0);
  if (subject + competitors === 0) {
    return { value: null, subject_mentions: 0, competitor_mentions: 0, n: valid.length, reason: 'Neither the company nor any known competitor was named in the valid answers; share of voice is undefined, not zero.' };
  }
  return { value: Number((subject / (subject + competitors)).toFixed(3)), subject_mentions: subject, competitor_mentions: competitors, n: valid.length, reason: null };
}

// ── Summary for the report (Agent 0 references this type) ────────────────────

export type ObservationRun = {
  /** Requested grounded runs per query (after clamping). */
  runs_requested: number;
  /** Runs actually scheduled after the budget pre-flight. */
  runs_effective: number;
  reduction_reason: string | null;
  /** Provider calls planned before probing; null when no pre-flight ran (N = 1). */
  planned_calls: number | null;
  grounded_first: boolean;
};

export type VisibilityObservationSummary = {
  /** Requested vs effective grounded runs per query. Comparability input (B4). */
  runs_per_query: { requested: number; effective: number; reduction_reason: string | null };
  attempts: { total: number; completed: number; failed: number; skipped: number; cache_hits: number };
  mention_rate: MentionRate;
  by_provider: Array<{ provider: AIProviderId; state: ScoreState; mention_rate: MentionRate }>;
  /** Per run index: how many valid answers named the company (k of n). */
  by_run: Array<{ run_index: number; named: number; n: number }>;
  /** Distribution of the company's order of first appearance. Not a rank. */
  answer_order: { distribution: Array<{ mention_order: number; answers: number }>; not_named: number; n: number };
  competitor_presence: Array<{ name: string; origin: 'known_list'; named_in: number; of: number }>;
  share_of_voice: ShareOfVoice;
  /** Cited hosts outside the company and the known list. Shown, never counted. */
  unverified_source_hosts: Array<{ host: string; answers: number; status: 'unverified' }>;
  sentiment: { state: 'unavailable'; reason: string };
  observations: VisibilityObservation[];
};

type MatrixLike = {
  cells: Array<{ provider: AIProviderId; state: ScoreState; observations?: VisibilityObservation[] }>;
  observation_run?: ObservationRun;
  known_competitors?: KnownCompetitor[];
};

/**
 * The report-facing summary of a matrix's observations. Pure. Returns null for
 * a matrix built before observations existed (absent = not recorded, never 0).
 */
export function summarizeVisibilityObservations(matrix: MatrixLike | null | undefined): VisibilityObservationSummary | null {
  if (!matrix || !Array.isArray(matrix.cells)) return null;
  if (!matrix.cells.some((c) => Array.isArray(c.observations))) return null;
  const obs = matrix.cells.flatMap((c) => c.observations ?? []);
  const known = matrix.known_competitors ?? [];
  const run = matrix.observation_run ?? { runs_requested: 1, runs_effective: 1, reduction_reason: null, planned_calls: null, grounded_first: false };
  const valid = obs.filter(isValidGroundedObservation);

  const providers = [...new Set(matrix.cells.map((c) => c.provider))];
  const byProvider = providers.map((provider) => {
    const cells = matrix.cells.filter((c) => c.provider === provider);
    const state: ScoreState = cells.some((c) => c.state === 'measured') ? 'measured'
      : cells.some((c) => c.state === 'insufficient_signal') ? 'insufficient_signal' : 'unavailable';
    return { provider, state, mention_rate: mentionRate(cells.flatMap((c) => c.observations ?? [])) };
  });

  const runs = [...new Set(valid.map((o) => o.run_index))].sort((a, b) => a - b);
  const orderCounts = new Map<number, number>();
  for (const o of valid) if (o.subject_mention_order !== null) orderCounts.set(o.subject_mention_order, (orderCounts.get(o.subject_mention_order) ?? 0) + 1);

  const presence = new Map<string, number>();
  for (const c of known) { const n = (c?.name ?? '').trim(); if (n && !presence.has(n)) presence.set(n, 0); }
  for (const o of valid) for (const e of o.entities) if (e.role === 'known_competitor' && presence.has(e.name)) presence.set(e.name, (presence.get(e.name) ?? 0) + 1);

  const unverified = new Map<string, number>();
  for (const o of valid) for (const h of o.unverified_source_hosts) unverified.set(h, (unverified.get(h) ?? 0) + 1);

  return {
    runs_per_query: { requested: run.runs_requested, effective: run.runs_effective, reduction_reason: run.reduction_reason },
    attempts: {
      total: obs.length,
      completed: obs.filter((o) => o.collection_status === 'completed').length,
      failed: obs.filter((o) => o.collection_status === 'failed').length,
      skipped: obs.filter((o) => o.collection_status === 'skipped_budget' || o.collection_status === 'skipped_rate_limit').length,
      cache_hits: obs.filter((o) => o.cache_hit).length,
    },
    mention_rate: mentionRate(obs),
    by_provider: byProvider,
    by_run: runs.map((r) => {
      const slice = valid.filter((o) => o.run_index === r);
      return { run_index: r, named: slice.filter((o) => o.appeared === true).length, n: slice.length };
    }),
    answer_order: {
      distribution: [...orderCounts.entries()].sort((a, b) => a[0] - b[0]).map(([mention_order, answers]) => ({ mention_order, answers })),
      not_named: valid.filter((o) => o.subject_mention_order === null).length,
      n: valid.length,
    },
    competitor_presence: [...presence.entries()].map(([name, named_in]) => ({ name, origin: 'known_list' as const, named_in, of: valid.length })),
    share_of_voice: shareOfVoice(obs, known),
    unverified_source_hosts: [...unverified.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([host, answers]) => ({ host, answers, status: 'unverified' as const })),
    sentiment: { state: 'unavailable', reason: 'Sentiment is deferred: no explainable answer-level classifier is applied.' },
    observations: obs,
  };
}
