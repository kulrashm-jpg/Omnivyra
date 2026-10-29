/**
 * Source-domain aggregate — which publisher domains the AI answers to BUYER questions cited.
 *
 * Counts are of distinct (answer, source) pairs and are kept apart by role: `citation_count`
 * (cited), `unknown_role_count` (a merged legacy list) and `retrieved_only_count` (searched, not
 * cited). They are never summed. Brand questions are excluded: they cite the subject's own pages by
 * construction (the same rule as publicResearch/collect.ts for buyer answers).
 *
 * Brand association is co-occurrence only: a brand is associated with a domain when the SAME answer
 * cited the domain and named the brand — in the answer's verbatim-checked `brandsNamed`, or, for the
 * subject and validated competitors, by a word-boundary match over the stored answer excerpt. It is
 * association, never attribution. Answers without text (scoring-run probes) contribute no association.
 */
import { registrableDomain } from '../../companyProfile/grounding/acquisition/sourceRegistry';
import { classifySourceHost, normalizeHost, type ClassifierContext } from './sourceDomainClassifier';
import type { AssociatedBrand, CitationSource, SourceClassification, SourceDomainAggregate } from './citationTypes';

/** What is known about one answer beyond its sources; absent for answers that kept no text. */
export type AnswerBrandData = {
  observation_id: string;
  brandsNamed?: string[] | null;
  excerpt?: string | null;
};

export type AggregateContext = {
  subject: { brand: string; domains: string[] };
  /** VALIDATED competitors only. */
  competitors: Array<{ name: string; domain: string }>;
  answers?: AnswerBrandData[];
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name: string) => new RegExp(`\\b${esc(name)}\\b`, 'i');
const questionKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');
const sortStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Citations that may count toward a domain: accepted (not rejected) and from buyer questions. */
export function countableCitations(sources: CitationSource[]): CitationSource[] {
  return sources.filter((s) => s.provenance.rejected_reason === null && !s.is_brand_question && s.registrable_domain && s.host);
}

function classifyGroup(domain: string, hosts: string[], ctx: ClassifierContext): SourceClassification {
  const byHost = [...new Set(hosts)].sort(sortStr).map((h) => classifySourceHost(h, ctx));
  const cats = new Set(byHost.map((c) => c.category));
  if (cats.size === 1) return byHost[0];
  const whole = classifySourceHost(domain, ctx);
  if (whole.category !== 'unknown') return whole;
  return { category: 'unknown', rule: 'mixed_hosts', list_version: whole.list_version };
}

export function aggregateSourceDomains(sources: CitationSource[], ctx: AggregateContext): SourceDomainAggregate[] {
  const classifierCtx: ClassifierContext = {
    subjectDomains: ctx.subject.domains,
    competitorDomains: ctx.competitors.map((c) => c.domain).filter(Boolean),
  };
  const answers = new Map((ctx.answers ?? []).map((a) => [a.observation_id, a]));
  const subjectRe = ctx.subject.brand ? wordRe(ctx.subject.brand) : null;
  const competitorRes = ctx.competitors.filter((c) => c.name).map((c) => ({ name: c.name, re: wordRe(c.name), lower: c.name.toLowerCase() }));

  const groups = new Map<string, CitationSource[]>();
  for (const s of countableCitations(sources)) {
    const d = registrableDomain(normalizeHost(s.registrable_domain!));
    (groups.get(d) ?? groups.set(d, []).get(d)!).push(s);
  }

  const out: SourceDomainAggregate[] = [];
  for (const [domain, list] of groups) {
    // One count per (answer, source key, role); citation_id already encodes all three.
    const uniq = [...new Map(list.map((s) => [s.citation_id, s])).values()];
    const cited = uniq.filter((s) => s.citation_role === 'cited');
    const unknown = uniq.filter((s) => s.citation_role === 'unknown');
    const retrieved = uniq.filter((s) => s.citation_role === 'retrieved');
    const counting = [...cited, ...unknown];
    const cls = classifyGroup(domain, uniq.map((s) => s.host!), classifierCtx);
    const obsIds = [...new Set(counting.map((s) => s.observation_id))].sort(sortStr);

    // Association: answers that cited (or listed) this domain and kept their text / brands.
    const brands = new Map<string, AssociatedBrand>();
    let withData = 0;
    let subjectNamed = 0;
    for (const id of obsIds) {
      const a = answers.get(id);
      if (!a) continue;
      withData += 1;
      const named = (a.brandsNamed ?? []).filter((b) => typeof b === 'string' && b.trim());
      const namedLower = new Set(named.map((b) => b.toLowerCase()));
      const text = String(a.excerpt ?? '');
      const add = (name: string, kind: AssociatedBrand['kind']) => {
        const key = `${kind}|${name.toLowerCase()}`;
        const cur = brands.get(key) ?? { name, kind, co_occurrences: 0, observation_ids: [] };
        if (!cur.observation_ids.includes(id)) { cur.co_occurrences += 1; cur.observation_ids.push(id); }
        brands.set(key, cur);
      };
      const subjectHere = Boolean(ctx.subject.brand) && (namedLower.has(ctx.subject.brand.toLowerCase()) || Boolean(subjectRe?.test(text)));
      if (subjectHere) { subjectNamed += 1; add(ctx.subject.brand, 'subject'); }
      const taken = new Set<string>(subjectHere ? [ctx.subject.brand.toLowerCase()] : []);
      for (const c of competitorRes) {
        if (namedLower.has(c.lower) || c.re.test(text)) { add(c.name, 'validated_competitor'); taken.add(c.lower); }
      }
      for (const b of named) if (!taken.has(b.toLowerCase())) add(b, 'other_named_brand');
    }

    const examples = [...new Set(
      [...cited, ...unknown, ...retrieved].filter((s) => s.url_precision === 'page' && s.normalized_url).map((s) => s.normalized_url!),
    )].slice(0, 3);
    out.push({
      registrable_domain: domain,
      category: cls.category,
      classification_rule: cls.rule,
      citation_count: cited.length,
      unknown_role_count: unknown.length,
      retrieved_only_count: retrieved.length,
      distinct_questions: new Set(counting.map((s) => questionKey(s.query))).size,
      distinct_providers: [...new Set(counting.map((s) => String(s.provider)))].sort(sortStr),
      example_urls: examples,
      citation_ids: uniq.map((s) => s.citation_id).sort(sortStr),
      observation_ids: obsIds,
      has_host_only: uniq.some((s) => s.url_precision === 'host_only'),
      associated_brands: [...brands.values()]
        .map((b) => ({ ...b, observation_ids: [...b.observation_ids].sort(sortStr) }))
        .sort((a, b) => b.co_occurrences - a.co_occurrences || sortStr(a.kind, b.kind) || sortStr(a.name.toLowerCase(), b.name.toLowerCase())),
      subject_named_in_citing_answers: withData ? subjectNamed : null,
      citing_answers_with_brand_data: withData,
    });
  }
  return out.sort((a, b) => b.citation_count - a.citation_count || b.unknown_role_count - a.unknown_role_count
    || b.distinct_questions - a.distinct_questions || b.distinct_providers.length - a.distinct_providers.length || sortStr(a.registrable_domain, b.registrable_domain));
}
