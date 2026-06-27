/**
 * Content Intelligence — the canonical deterministic KNOWLEDGE-EXTRACTION layer
 * between Content Package and Content Architecture. It UNDERSTANDS content before
 * sequencing: it extracts, classifies, normalises, de-duplicates, and scores —
 * it NEVER generates, modifies, renders, or reasons (no AI). Every downstream
 * module (Architecture, Story Blueprint, Diagnostics, Recommendation, …) consumes
 * this output instead of re-extracting. Pure: same text → same intelligence.
 */

export type Importance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface KnowledgeItem {
  id: string;
  category: KnowledgeCategory;
  text: string;
  confidence: number;   // 0..1
  location: number;     // line index in the source
  source: string;       // provenance (origin)
  priority: number;     // category base priority
  duplicateGroup: string;
  importance: Importance;
}

export type KnowledgeCategory =
  | 'products' | 'services' | 'audiences' | 'industries' | 'competitors'
  | 'features' | 'benefits' | 'painPoints' | 'solutions'
  | 'statistics' | 'metrics' | 'numbers'
  | 'testimonials' | 'caseStudies' | 'socialProof' | 'quotes'
  | 'ctas' | 'faqs'
  | 'processes' | 'frameworks' | 'comparisons' | 'timelines'
  | 'pricing' | 'keywords' | 'claims' | 'risks' | 'references' | 'entities';

export interface ContentIntelligence {
  entities: KnowledgeItem[];
  products: KnowledgeItem[];
  services: KnowledgeItem[];
  audiences: KnowledgeItem[];
  industries: KnowledgeItem[];
  competitors: KnowledgeItem[];
  features: KnowledgeItem[];
  benefits: KnowledgeItem[];
  painPoints: KnowledgeItem[];
  solutions: KnowledgeItem[];
  statistics: KnowledgeItem[];
  metrics: KnowledgeItem[];
  numbers: KnowledgeItem[];
  testimonials: KnowledgeItem[];
  caseStudies: KnowledgeItem[];
  socialProof: KnowledgeItem[];
  quotes: KnowledgeItem[];
  ctas: KnowledgeItem[];
  faqs: KnowledgeItem[];
  processes: KnowledgeItem[];
  frameworks: KnowledgeItem[];
  comparisons: KnowledgeItem[];
  timelines: KnowledgeItem[];
  pricing: KnowledgeItem[];
  keywords: KnowledgeItem[];
  claims: KnowledgeItem[];
  risks: KnowledgeItem[];
  references: KnowledgeItem[];
  metadata: { lineCount: number; wordCount: number; source: string };
}

const CATEGORY_PRIORITY: Record<KnowledgeCategory, number> = {
  ctas: 1, statistics: 1, benefits: 2, painPoints: 2, solutions: 2, testimonials: 2, caseStudies: 2,
  pricing: 2, products: 3, services: 3, features: 3, quotes: 3, socialProof: 3, claims: 3, risks: 1,
  faqs: 3, processes: 3, frameworks: 3, comparisons: 3, timelines: 3, metrics: 2, numbers: 4,
  audiences: 3, industries: 3, competitors: 3, keywords: 4, references: 4, entities: 4,
};

const STOPWORDS = new Set('the a an and or but of to in on for with at by from as is are was were be been being this that these those it its our your their we you they i he she his her them us not no can will would should could may might more most very just so than then also into over under about'.split(' '));

function lc(s: string): string { return s.toLowerCase(); }
function words(s: string): string[] { return lc(s).replace(/[^a-z0-9%$.\s-]/g, ' ').split(/\s+/).filter(Boolean); }
// Letter-only content words (punctuation stripped) — for keywords + duplicate
// grouping, so "productivity." and "productivity" collapse to one anchor.
function contentWords(s: string): string[] { return lc(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w)); }

/** Deterministic duplicate key — the dominant content word(s) of a phrase. */
function duplicateKey(text: string): string {
  const cw = contentWords(text);
  if (!cw.length) return lc(text).slice(0, 24);
  // The longest content word is the stable anchor (productivity ← increase/boost/improve productivity).
  return [...cw].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0]!;
}

/* ── Extraction primitives ─────────────────────────────────────────────── */

interface RawHit { text: string; location: number; confidence: number; }

const CTA_RE = /\b(sign up|get started|learn more|book a (demo|call)|contact us|try (it )?free|try now|download|subscribe|buy now|request (a )?(demo|quote)|start (your )?(free )?trial|join (now|today)|see how|talk to (us|sales)|get a quote)\b/i;
const SUPERLATIVE_RE = /\b(best|#1|number one|world[- ]class|leading|fastest|only|unmatched|revolutionary|guaranteed|never|always|100% )\b/i;
const RISK_RE = /\b(guarantee[d]?|100%|risk[- ]free|cure|never fail|always works|instant results|no risk)\b/i;
const BENEFIT_RE = /\b(increase|boost|improve|save|reduce|cut|faster|grow|accelerate|streamline|simplif|maximi[sz]e|lower|double|triple|unlock|drive)\b/i;
const PAIN_RE = /\b(struggle|pain|challenge|difficult|frustrat|waste|slow|manual|error[- ]prone|bottleneck|problem|inefficien|costly|tedious|time[- ]consuming)\b/i;
const SOLUTION_RE = /\b(solution|solve[ds]?|fix|automat|enabl|allow you to|helps? you|so you can|with our|powered by)\b/i;
const PROCESS_RE = /^(step\s*\d|first[,:]|then[,:]|next[,:]|finally[,:]|\d+[.)]\s)/i;
const FRAMEWORK_RE = /\b(framework|methodology|the \w+ (method|model|formula)|\d+ pillars?|playbook)\b/i;
const COMPARISON_RE = /\b(versus|vs\.?|compared to|better than|instead of|either .* or|trade[- ]?offs?)\b/i;
const INDUSTRY_RE = /\b(saas|fintech|e[- ]?commerce|healthcare|real estate|b2b|b2c|edtech|manufacturing|retail|logistics|insurance|legal|hospitality)\b/i;
const AUDIENCE_RE = /\bfor (executives?|founders?|marketers?|developers?|smbs?|enterprises?|teams?|managers?|cmos?|ctos?|startups?|agencies)\b/i;
const COMPETITOR_RE = /\b(competitor|alternative to|unlike|switch from)\b/i;
const PRICE_RE = /[$£€]\s?\d[\d,]*(\.\d+)?(\s?(k|m|bn|billion|million|\/(mo|month|year|yr|user|seat)))?/i;
const PERCENT_RE = /\b\d+(\.\d+)?\s?%/;
const MULTIPLIER_RE = /\b\d+(\.\d+)?x\b/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const URL_RE = /https?:\/\/[^\s)]+/i;
const QUOTE_RE = /[“"]([^”"]{8,240})[”"]/;
const ATTRIB_RE = /[—-]\s*[A-Z][a-z]+(\s+[A-Z][a-z]+)?(,|\s+(CEO|CTO|VP|Director|Founder|Manager|Head))/;

function pushHit(map: Map<string, RawHit[]>, cat: KnowledgeCategory, text: string, location: number, confidence: number) {
  const t = text.trim();
  if (!t) return;
  (map.get(cat) ?? map.set(cat, []).get(cat)!).push({ text: t, location, confidence });
}

/* ── Importance scoring ────────────────────────────────────────────────── */

function score(item: { location: number; confidence: number; freq: number; inHeadline: boolean; nearCta: boolean; totalLines: number }): Importance {
  let s = 0;
  s += Math.min(item.freq, 4) * 1.2;                              // frequency
  s += item.inHeadline ? 2.5 : 0;                                 // headline/title presence
  s += item.location <= Math.max(1, item.totalLines * 0.15) ? 1.5 : 0; // early position
  s += item.nearCta ? 1 : 0;                                      // CTA proximity
  s += item.confidence * 2;                                       // extractor confidence
  return s >= 5.5 ? 'HIGH' : s >= 3 ? 'MEDIUM' : 'LOW';
}

/* ── Main extractor ────────────────────────────────────────────────────── */

export function extractIntelligence(text: string, source = 'package'): ContentIntelligence {
  const safe = (text || '').replace(/\r/g, '');
  const lines = safe.split('\n').map((l) => l.trim());
  const sentences = safe.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const headline = lines.find(Boolean) ?? '';
  const headlineLc = lc(headline);
  const ctaLines = new Set<number>();
  lines.forEach((l, i) => { if (CTA_RE.test(l)) ctaLines.add(i); });

  const hits = new Map<KnowledgeCategory, RawHit[]>();

  // Sentence/line scans.
  sentences.forEach((s) => {
    const loc = Math.max(0, lines.findIndex((l) => l.includes(s.slice(0, Math.min(24, s.length)))));
    if (BENEFIT_RE.test(s)) pushHit(hits, 'benefits', s, loc, 0.7);
    if (PAIN_RE.test(s)) pushHit(hits, 'painPoints', s, loc, 0.7);
    if (SOLUTION_RE.test(s)) pushHit(hits, 'solutions', s, loc, 0.6);
    if (FRAMEWORK_RE.test(s)) pushHit(hits, 'frameworks', s, loc, 0.7);
    if (COMPARISON_RE.test(s)) pushHit(hits, 'comparisons', s, loc, 0.65);
    if (SUPERLATIVE_RE.test(s)) pushHit(hits, 'claims', s, loc, 0.8);
    if (RISK_RE.test(s)) pushHit(hits, 'risks', s, loc, 0.85);
    const ind = s.match(INDUSTRY_RE); if (ind) pushHit(hits, 'industries', ind[0], loc, 0.8);
    const aud = s.match(AUDIENCE_RE); if (aud) pushHit(hits, 'audiences', aud[1] ?? aud[0], loc, 0.75);
    if (COMPETITOR_RE.test(s)) pushHit(hits, 'competitors', s, loc, 0.6);
  });

  lines.forEach((l, i) => {
    if (!l) return;
    const pct = l.match(PERCENT_RE); if (pct) pushHit(hits, 'statistics', pct[0], i, 0.95);
    const mult = l.match(MULTIPLIER_RE); if (mult) pushHit(hits, 'statistics', mult[0], i, 0.9);
    const price = l.match(PRICE_RE); if (price) pushHit(hits, 'pricing', price[0], i, 0.9);
    const year = l.match(YEAR_RE); if (year) pushHit(hits, 'timelines', l, i, 0.55);
    const url = l.match(URL_RE); if (url) pushHit(hits, 'references', url[0], i, 0.95);
    const q = l.match(QUOTE_RE); if (q) { pushHit(hits, 'quotes', q[1]!, i, 0.85); if (ATTRIB_RE.test(l)) { pushHit(hits, 'testimonials', l, i, 0.8); pushHit(hits, 'socialProof', l, i, 0.7); } }
    if (CTA_RE.test(l)) pushHit(hits, 'ctas', l, i, 0.9);
    if (l.endsWith('?')) pushHit(hits, 'faqs', l, i, 0.8);
    if (PROCESS_RE.test(l)) pushHit(hits, 'processes', l, i, 0.75);
    // plain numbers/metrics (non-trivial integers, exclude years/percents already caught)
    const num = l.match(/\b\d[\d,]{2,}\b/); if (num && !pct && !year) pushHit(hits, 'numbers', num[0], i, 0.6);
  });

  // Keywords — top frequency content words.
  const freq = new Map<string, number>();
  for (const w of contentWords(safe)) freq.set(w, (freq.get(w) ?? 0) + 1);
  Array.from(freq.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15)
    .forEach(([w], i) => pushHit(hits, 'keywords', w, 0, Math.min(1, 0.4 + (freq.get(w)! / 10))));

  // Products/services/entities — capitalised multi-word proper nouns (heuristic).
  const proper = safe.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,2})\b/g) ?? [];
  const properFreq = new Map<string, number>();
  for (const p of proper) if (!STOPWORDS.has(lc(p)) && p.length > 3) properFreq.set(p, (properFreq.get(p) ?? 0) + 1);
  Array.from(properFreq.entries()).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([p]) => pushHit(hits, 'entities', p, 0, 0.5));

  // ── Materialise KnowledgeItems with dedup + importance ──
  const out: Partial<Record<KnowledgeCategory, KnowledgeItem[]>> = {};
  for (const [cat, rawHits] of hits) {
    // De-duplicate exact text; keep first occurrence, count frequency.
    const byText = new Map<string, { hit: RawHit; freq: number }>();
    for (const h of rawHits) {
      const k = lc(h.text);
      const e = byText.get(k);
      if (e) e.freq += 1; else byText.set(k, { hit: h, freq: 1 });
    }
    const items: KnowledgeItem[] = [];
    let idx = 0;
    for (const { hit, freq: f } of byText.values()) {
      const dg = duplicateKey(hit.text);
      const inHeadline = headlineLc.includes(lc(hit.text).slice(0, Math.min(20, hit.text.length)));
      const nearCta = ctaLines.has(hit.location) || ctaLines.has(hit.location + 1) || ctaLines.has(hit.location - 1);
      items.push({
        id: `${cat}-${idx++}`, category: cat, text: hit.text, confidence: hit.confidence,
        location: hit.location, source, priority: CATEGORY_PRIORITY[cat], duplicateGroup: dg,
        importance: score({ location: hit.location, confidence: hit.confidence, freq: f, inHeadline, nearCta, totalLines: lines.length }),
      });
    }
    // Stable order: importance desc, then location asc, then text.
    const rank: Record<Importance, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    items.sort((a, b) => rank[a.importance] - rank[b.importance] || a.location - b.location || (a.text < b.text ? -1 : 1));
    out[cat] = items;
  }

  const empty: KnowledgeItem[] = [];
  return {
    entities: out.entities ?? empty, products: out.products ?? empty, services: out.services ?? empty,
    audiences: out.audiences ?? empty, industries: out.industries ?? empty, competitors: out.competitors ?? empty,
    features: out.features ?? empty, benefits: out.benefits ?? empty, painPoints: out.painPoints ?? empty, solutions: out.solutions ?? empty,
    statistics: out.statistics ?? empty, metrics: out.metrics ?? empty, numbers: out.numbers ?? empty,
    testimonials: out.testimonials ?? empty, caseStudies: out.caseStudies ?? empty, socialProof: out.socialProof ?? empty, quotes: out.quotes ?? empty,
    ctas: out.ctas ?? empty, faqs: out.faqs ?? empty,
    processes: out.processes ?? empty, frameworks: out.frameworks ?? empty, comparisons: out.comparisons ?? empty, timelines: out.timelines ?? empty,
    pricing: out.pricing ?? empty, keywords: out.keywords ?? empty, claims: out.claims ?? empty, risks: out.risks ?? empty, references: out.references ?? empty,
    metadata: { lineCount: lines.filter(Boolean).length, wordCount: words(safe).length, source },
  };
}

/* ── Summary / search / blueprint mapping (deterministic consumers) ────── */

export type ContentKnowledgeSummary = Record<KnowledgeCategory, number>;

export function summarize(intel: ContentIntelligence): ContentKnowledgeSummary {
  const cats = Object.keys(CATEGORY_PRIORITY) as KnowledgeCategory[];
  const out = {} as ContentKnowledgeSummary;
  for (const c of cats) out[c] = (intel[c] as KnowledgeItem[]).length;
  return out;
}

const SEARCH_ALIASES: Array<[RegExp, KnowledgeCategory]> = [
  [/\bstat|\bpercent|\bmetric/, 'statistics'], [/\btestimonial|\breview/, 'testimonials'], [/\bcta\b|call.to.action/, 'ctas'],
  [/\bpric|\bcost\b|\boffer\b/, 'pricing'], [/\bclaim/, 'claims'], [/\bproducts?\b/, 'products'], [/\bcompetitor|\brival/, 'competitors'],
  [/\bbenefit/, 'benefits'], [/\bpain\b|\bproblem/, 'painPoints'], [/\bquote/, 'quotes'], [/\bfaq\b|\bquestion/, 'faqs'],
  [/\bframework/, 'frameworks'], [/\bprocess|\bsteps?\b/, 'processes'], [/\baudience/, 'audiences'], [/\bindustr/, 'industries'],
  [/\brisk/, 'risks'], [/\bkeyword/, 'keywords'], [/\breference|\blink\b|\burl\b/, 'references'], [/\btimeline|\bdate\b|\byear/, 'timelines'],
];

/** Deterministic search: "find statistics" → statistics[]. Falls back to text match. */
export function searchIntelligence(intel: ContentIntelligence, query: string): KnowledgeItem[] {
  const q = lc(query).replace(/^find\s+/, '').trim();
  for (const [re, cat] of SEARCH_ALIASES) if (re.test(q)) return intel[cat] as KnowledgeItem[];
  // free-text: match item text across all categories
  const cats = Object.keys(CATEGORY_PRIORITY) as KnowledgeCategory[];
  return cats.flatMap((c) => intel[c] as KnowledgeItem[]).filter((it) => lc(it.text).includes(q));
}

/**
 * Map a Story Blueprint's narrative roles → the intelligence categories that
 * fill them, so the blueprint CONSUMES intelligence (Benefits[]/Statistics[]/…)
 * instead of extracting. Deterministic; the blueprint module is unchanged.
 */
const ROLE_CATEGORY: Array<[RegExp, KnowledgeCategory]> = [
  [/problem|pain|challenge|tension|before|myth|common belief/, 'painPoints'],
  [/solution|approach|after|fact|fix/, 'solutions'],
  [/stat|result|number|proof|evidence|metric/, 'statistics'],
  [/testimon|customer|advoca/, 'testimonials'],
  [/cta|call|where to|learn more|next/, 'ctas'],
  [/benefit|takeaway|outcome|so what|implication/, 'benefits'],
  [/framework|pillar|method|criteria/, 'frameworks'],
  [/example|in action|execution|case/, 'caseStudies'],
  [/concept|explain|insight|context|overview/, 'features'],
  [/step|stage|process|how to apply/, 'processes'],
  [/quote|claim|hook|bold/, 'quotes'],
  [/milestone|timeline|origin|today/, 'timelines'],
  [/comparison|option|verdict|trade/, 'comparisons'],
  [/faq|q\d|question/, 'faqs'],
];

export function blueprintRoleToIntelligence(narrativeFlow: string[], intel: ContentIntelligence): Array<{ role: string; category: KnowledgeCategory | null; items: KnowledgeItem[] }> {
  return narrativeFlow.map((role) => {
    const lcRole = lc(role);
    const match = ROLE_CATEGORY.find(([re]) => re.test(lcRole));
    const category = match ? match[1] : null;
    return { role, category, items: category ? (intel[category] as KnowledgeItem[]) : [] };
  });
}
