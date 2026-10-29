/**
 * AI-visibility observations — pure metrics and known-list entity matching.
 * Hermetic: no adapters, no network. Domains are `*.test`.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  clampGroundedRuns,
  completedObservation,
  errorClassFromError,
  extractAnswerEntities,
  mentionRate,
  observationId,
  rememberAnswer,
  shareOfVoice,
  summarizeVisibilityObservations,
  unansweredObservation,
  type VisibilityObservation,
} from '../../services/intelligence/visibilityObservation';
import { extractCitation } from '../../services/intelligence/citationExtractor';
import { HardFailureError, TimeoutError } from '../../services/intelligence/productionPrimitives';

const BRAND = 'Northwind Analytics';
const DOMAIN = 'northwind.test';
const KNOWN = [{ name: 'Contoso Cloud', domain: 'contoso.test' }, { name: 'Fabrikam', domain: null }];
const T = '2026-10-29T00:00:00.000Z';

function completed(answer: string, sources: string[], opts: { grounded?: boolean; run?: number; query?: string } = {}): VisibilityObservation {
  const mention = extractCitation({ provider: 'perplexity', query: opts.query ?? 'q', query_class: 'category', answer, brandName: BRAND, domain: DOMAIN, groundedSources: sources, observedAt: T });
  rememberAnswer(mention, answer, 'sonar');
  return completedObservation({
    provider: 'perplexity', retrievalGrounded: opts.grounded ?? true, query: opts.query ?? 'q', queryClass: 'category',
    runIndex: opts.run ?? 0, brandName: BRAND, domain: DOMAIN, mention, cacheHit: false, knownCompetitors: KNOWN,
  });
}
const failed = (run = 0) => unansweredObservation({
  provider: 'perplexity', retrievalGrounded: true, query: 'q', queryClass: 'category', runIndex: run,
  brandName: BRAND, domain: DOMAIN, status: 'failed', errorClass: 'request_failed', reason: 'synthetic', observedAt: T,
});

describe('clampGroundedRuns', () => {
  it('clamps to 1..5 and defaults non-numbers to 1', () => {
    expect([undefined, null, NaN, 0, -3, 1, 2.9, 5, 6, 99].map(clampGroundedRuns)).toEqual([1, 1, 1, 1, 1, 1, 2, 5, 5, 5]);
  });
});

describe('observation records', () => {
  it('observation_id is a stable sha256 of (provider, class, query, identity, run, observed_at)', () => {
    const a = completed('Northwind Analytics leads.', ['https://northwind.test/x']);
    const b = completed('Northwind Analytics leads.', ['https://northwind.test/x']);
    expect(a.observation_id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.observation_id).toBe(b.observation_id);
    expect(completed('Northwind Analytics leads.', ['https://northwind.test/x'], { run: 1 }).observation_id).not.toBe(a.observation_id);
    expect(observationId({ provider: 'perplexity', query_class: 'category', query: 'q', fingerprint: a.subject.fingerprint, run_index: 0, observed_at: T })).toBe(a.observation_id);
  });

  it('carries grounded_sources verbatim and retrieval_grounded', () => {
    const src = ['https://northwind.test/a?x=1', 'https://contoso.test/b'];
    const o = completed('Northwind Analytics.', src);
    expect(o.grounded_sources).toEqual(src);
    expect(o.retrieval_grounded).toBe(true);
  });

  it('stores only a hash and a ≤240-char excerpt of the answer', () => {
    const long = `Northwind Analytics ${'x '.repeat(500)}`;
    const o = completed(long, ['https://northwind.test/']);
    expect(o.answer_ref!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(o.answer_ref!.length_chars).toBe(long.length);
    expect(o.answer_ref!.excerpt!.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(o)).not.toContain('x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x');
  });

  it('failed / skipped attempts have no appeared, no sources and an error class', () => {
    const f = failed();
    expect(f.appeared).toBeNull();
    expect(f.prominence).toBeNull();
    expect(f.collection_status).toBe('failed');
    expect(f.error_class).toBe('request_failed');
    expect(f.answer_ref).toBeNull();
  });

  it('maps adapter errors onto the provider-error vocabulary', () => {
    expect(errorClassFromError(new TimeoutError('perplexity', 10))).toBe('provider_unavailable');
    expect(errorClassFromError(new HardFailureError('perplexity', 'auth_failure', 'x'))).toBe('invalid_credential');
    expect(errorClassFromError(new HardFailureError('perplexity', 'quota_exceeded', 'x'))).toBe('quota_exhausted');
    expect(errorClassFromError(new HardFailureError('perplexity', 'rate_limited', 'x'))).toBe('rate_limited');
    expect(errorClassFromError(new Error('boom'))).toBe('request_failed');
  });
});

describe('mention rate', () => {
  it('= appeared / completed grounded-sourced answers; failed, unsourced and ungrounded excluded', () => {
    const obs = [
      completed('Northwind Analytics is good.', ['https://a.test/']),
      completed('Contoso Cloud only.', ['https://a.test/']),
      completed('Northwind Analytics, unsourced.', []), // excluded: no sources
      completed('Northwind Analytics, chat model.', ['https://a.test/'], { grounded: false }), // excluded: not grounded
      failed(),
    ];
    expect(mentionRate(obs)).toEqual({ value: 0.5, numerator: 1, n: 2, reason: null });
  });

  it('is null with a reason (never 0) when nothing valid exists', () => {
    const r = mentionRate([failed(), failed(1)]);
    expect(r.value).toBeNull();
    expect(r.n).toBe(0);
    expect(r.reason).toMatch(/no mention rate/i);
  });
});

describe('entities — known list only, order of first appearance', () => {
  it('orders by first appearance and never calls it a rank', () => {
    const e = extractAnswerEntities({ answer: 'Contoso Cloud leads; Northwind Analytics follows; Fabrikam too.', groundedSources: [], brandName: BRAND, domain: DOMAIN, knownCompetitors: KNOWN });
    expect(e.entities.map((x) => [x.name, x.mention_order])).toEqual([['Contoso Cloud', 1], [BRAND, 2], ['Fabrikam', 3]]);
    expect(e.subject_mention_order).toBe(2);
    expect(JSON.stringify(e)).not.toMatch(/rank/i);
  });

  it('does not invent entities: unlisted brands in the text are ignored', () => {
    const e = extractAnswerEntities({ answer: 'Globex, Initech and Umbrella dominate.', groundedSources: [], brandName: BRAND, domain: DOMAIN, knownCompetitors: KNOWN });
    expect(e.entities).toEqual([]);
    expect(e.subject_mention_order).toBeNull();
  });

  it('respects token edges (no "Fabrikam" inside "Fabrikamworks") and short/generic names', () => {
    const e = extractAnswerEntities({ answer: 'Fabrikamworks and Cloud are different.', groundedSources: [], brandName: BRAND, domain: DOMAIN, knownCompetitors: [...KNOWN, { name: 'Cloud' }, { name: 'AB' }] });
    expect(e.entities).toEqual([]);
  });

  it('the company is never its own competitor', () => {
    const e = extractAnswerEntities({ answer: 'Northwind Analytics.', groundedSources: [], brandName: BRAND, domain: DOMAIN, knownCompetitors: [{ name: BRAND }, { name: 'Other', domain: 'northwind.test' }] });
    expect(e.entities.filter((x) => x.role === 'known_competitor')).toEqual([]);
  });

  it('cited hosts: known competitor by host equality / true subdomain; others are unverified', () => {
    const e = extractAnswerEntities({
      answer: 'No names here.',
      groundedSources: ['https://docs.contoso.test/p', 'https://contoso.test.attacker.test/x', 'https://northwind.test/', 'https://reviews.example.test/'],
      brandName: BRAND, domain: DOMAIN, knownCompetitors: KNOWN,
    });
    expect(e.entities).toEqual([expect.objectContaining({ name: 'Contoso Cloud', match_basis: 'cited_source_host', mention_order: null })]);
    expect(e.unverified_source_hosts.sort()).toEqual(['contoso.test.attacker.test', 'reviews.example.test']);
  });
});

describe('share of voice', () => {
  const four = () => [
    completed('Northwind Analytics and Contoso Cloud.', ['https://a.test/']),
    completed('Contoso Cloud.', ['https://a.test/']),
    completed('Fabrikam and Northwind Analytics.', ['https://a.test/']),
    completed('Nothing relevant.', ['https://a.test/']),
  ];

  it('null + reason without a known competitor list', () => {
    const s = shareOfVoice(four(), []);
    expect(s.value).toBeNull();
    expect(s.reason).toMatch(/competitor list/);
  });

  it('null + reason with fewer than 4 valid answers (failed attempts do not count)', () => {
    const s = shareOfVoice([...four().slice(0, 3), failed(), failed(1)], KNOWN);
    expect(s.value).toBeNull();
    expect(s.n).toBe(3);
    expect(s.reason).toMatch(/at least 4/);
  });

  it('= subject / (subject + known competitor mentions) over the same valid answers', () => {
    const s = shareOfVoice(four(), KNOWN);
    expect(s).toEqual({ value: 0.4, subject_mentions: 2, competitor_mentions: 3, n: 4, reason: null });
  });
});

describe('summarizeVisibilityObservations', () => {
  it('returns null for a matrix with no observations (stored reports before Phase B)', () => {
    expect(summarizeVisibilityObservations(null)).toBeNull();
    expect(summarizeVisibilityObservations({ cells: [{ provider: 'perplexity', state: 'measured' }] })).toBeNull();
  });

  it('reports runs requested vs effective, attempts, k-of-n per run and unverified hosts', () => {
    const obs = [
      completed('Northwind Analytics.', ['https://reviews.example.test/'], { run: 0 }),
      completed('Contoso Cloud.', ['https://contoso.test/'], { run: 1 }),
      failed(2),
    ];
    const s = summarizeVisibilityObservations({
      cells: [{ provider: 'perplexity', state: 'measured', observations: obs }],
      observation_run: { runs_requested: 3, runs_effective: 3, reduction_reason: null, planned_calls: 9, grounded_first: true },
      known_competitors: KNOWN,
    })!;
    expect(s.runs_per_query).toEqual({ requested: 3, effective: 3, reduction_reason: null });
    expect(s.attempts).toEqual({ total: 3, completed: 2, failed: 1, skipped: 0, cache_hits: 0 });
    expect(s.by_run).toEqual([{ run_index: 0, named: 1, n: 1 }, { run_index: 1, named: 0, n: 1 }]);
    expect(s.competitor_presence).toEqual([
      { name: 'Contoso Cloud', origin: 'known_list', named_in: 1, of: 2 },
      { name: 'Fabrikam', origin: 'known_list', named_in: 0, of: 2 },
    ]);
    expect(s.unverified_source_hosts).toEqual([{ host: 'reviews.example.test', answers: 1, status: 'unverified' }]);
    expect(s.share_of_voice.value).toBeNull();
    expect(s.sentiment.state).toBe('unavailable');
  });
});
