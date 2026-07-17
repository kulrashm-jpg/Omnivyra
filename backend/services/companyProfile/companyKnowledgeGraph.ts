/**
 * Company Knowledge Graph — the ONE canonical model of "what we know about this
 * company" and the ONE question-governance authority for the Company Profile
 * conversation. It is intentionally scoped to the Company Profile only (not a
 * cross-chat framework); it is designed so it can later become the shared engine
 * once proven in production.
 *
 * It is NOT a vector store / RAG. It is structured company knowledge: a fixed
 * registry of knowledge NODES, each resolved from the canonical CompanyProfile
 * columns + field_confidence. Every node carries a state, confidence, source,
 * and timestamp. Question governance selects the highest-value UNKNOWN node and
 * never asks about a node that is already satisfied — so equivalent phrasings of
 * an answered question are all permanently ineligible (semantic dedup by node
 * identity, not by wording).
 *
 * Reuse-first: it reads the existing profile (no new schema), the existing
 * field_confidence bands, and user_locked_fields. It does not duplicate the
 * refine pipeline, the completeness calculators, or the campaign QA-state engine.
 */

import type { CompanyProfile } from './types';

// ── Node state model ─────────────────────────────────────────────────────────

export type KnowledgeState = 'unknown' | 'observed' | 'inferred' | 'confirmed' | 'corrected';
export type KnowledgeConfidence = 'none' | 'low' | 'medium' | 'high';

export interface KnowledgeNode {
  id: string;
  label: string;
  /** Profile section this node belongs to (for grouping / value ordering). */
  section: 'identity' | 'offering' | 'audience' | 'positioning' | 'commercial' | 'reach' | 'firmographics';
  /** Priority weight — higher = ask earlier. Core-business nodes rank highest. */
  value: number;
  /** The canonical question to ask when this node is unknown. */
  question: string;
  /**
   * Keyword sets that identify an EQUIVALENT question. Any inbound question text
   * matching these keywords resolves to this node — so once the node is
   * satisfied, every equivalent phrasing becomes ineligible (semantic dedup).
   */
  equivalents: string[][];
  /** Minimum confidence for the node to count as satisfied (default 'low'). */
  minConfidence?: KnowledgeConfidence;
}

export interface KnowledgeNodeResolution {
  id: string;
  label: string;
  section: KnowledgeNode['section'];
  value: number;
  state: KnowledgeState;
  confidence: KnowledgeConfidence;
  /** Where the value came from (band-derived; the flat profile does not persist per-field source). */
  source: 'profile' | 'user' | 'inferred' | 'unknown';
  /** The resolved value (string form) or null. */
  resolvedValue: string | null;
  satisfied: boolean;
  question: string;
}

// ── Canonical node registry ──────────────────────────────────────────────────
// Each node maps to the CompanyProfile column(s) that satisfy it. `value`
// orders the interview: core business (what/who/why) before reach/firmographics.

export const KNOWLEDGE_NODES: KnowledgeNode[] = [
  { id: 'company', label: 'Company name', section: 'identity', value: 100, minConfidence: 'low',
    question: 'What is your company called?', equivalents: [['company', 'name'], ['who are you']] },
  { id: 'website', label: 'Website', section: 'identity', value: 98, minConfidence: 'low',
    question: 'What is your website address?', equivalents: [['website'], ['domain'], ['url']] },
  { id: 'industry', label: 'Industry', section: 'identity', value: 92,
    question: 'What industry or category best describes your company?', equivalents: [['industry'], ['category'], ['what sector']] },
  { id: 'products_services', label: 'Products & services', section: 'offering', value: 96,
    question: 'What do you sell — your core products or services?',
    equivalents: [['products'], ['services'], ['what do you sell'], ['what do you offer'], ['what does your company do'], ['what do you provide'], ['offering']] },
  { id: 'target_audience', label: 'Target audience', section: 'audience', value: 90,
    question: 'Who is your target audience — the customers you serve?',
    equivalents: [['target', 'audience'], ['who are your customers'], ['who do you serve'], ['target', 'customer'], ['who do you sell to']] },
  { id: 'ideal_customer_profile', label: 'Ideal customer profile', section: 'audience', value: 78,
    question: 'How would you describe your ideal customer profile (ICP)?',
    equivalents: [['ideal', 'customer'], ['icp'], ['best fit customer']] },
  { id: 'unique_value', label: 'Differentiators / unique value', section: 'positioning', value: 88,
    question: 'What makes you different — your unique value or key differentiators?',
    equivalents: [['unique', 'value'], ['differentiat'], ['what makes you different'], ['competitive advantage'], ['why choose you'], ['usp']] },
  { id: 'brand_positioning', label: 'Positioning', section: 'positioning', value: 72,
    question: 'How do you position your brand in the market?',
    equivalents: [['positioning'], ['brand', 'position'], ['how do you position']] },
  { id: 'brand_voice', label: 'Brand voice', section: 'positioning', value: 60,
    question: 'How would you describe your brand voice or tone?',
    equivalents: [['brand', 'voice'], ['tone'], ['brand', 'personality']] },
  { id: 'geography', label: 'Markets / geography', section: 'reach', value: 68,
    question: 'Which markets or geographies do you operate in?',
    equivalents: [['geography'], ['markets'], ['where do you operate'], ['regions'], ['countries']] },
  { id: 'competitors', label: 'Competitors', section: 'positioning', value: 66,
    question: 'Who are your main competitors?',
    equivalents: [['competitors'], ['rivals'], ['who do you compete']] },
  { id: 'business_model', label: 'Business model', section: 'commercial', value: 70,
    question: 'What is your business model — how do you price and sell?',
    equivalents: [['business model'], ['pricing'], ['sales motion'], ['how do you make money'], ['how do you charge']] },
  { id: 'goals', label: 'Goals / growth priorities', section: 'commercial', value: 62,
    question: 'What are your current goals or growth priorities?',
    equivalents: [['goals'], ['objectives'], ['growth', 'priorit'], ['what do you want to achieve']] },
  { id: 'content_themes', label: 'Content themes', section: 'offering', value: 50,
    question: 'What content themes or topics do you want to be known for?',
    equivalents: [['content', 'themes'], ['topics'], ['what do you post about']] },
  { id: 'social', label: 'Social platforms', section: 'reach', value: 48,
    question: 'Which social platforms are you active on?',
    equivalents: [['social'], ['platforms'], ['linkedin'], ['channels']] },
  { id: 'team', label: 'Team size', section: 'firmographics', value: 40,
    question: 'How big is your team?', equivalents: [['team', 'size'], ['how many employees'], ['headcount']] },
  { id: 'core_problem', label: 'Core problem you solve', section: 'positioning', value: 74,
    question: 'What core problem do you solve for customers?',
    equivalents: [['problem', 'solve'], ['core problem'], ['pain point'], ['what problem']] },
  { id: 'desired_transformation', label: 'Desired transformation', section: 'positioning', value: 58,
    question: 'What transformation do customers get from working with you?',
    equivalents: [['transformation'], ['outcome'], ['result', 'customer'], ['life after']] },
];

const CONFIDENCE_RANK: Record<KnowledgeConfidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

// ── Value resolution from the canonical profile ──────────────────────────────

const str = (v: unknown): string => (Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v ?? '')).trim();

/** First non-empty value across a node's candidate columns. */
function resolveNodeValue(p: CompanyProfile, id: string): string | null {
  const g = p as unknown as Record<string, unknown>;
  const first = (...keys: string[]): string | null => {
    for (const k of keys) { const s = str(g[k]); if (s) return s; }
    return null;
  };
  switch (id) {
    case 'company': return first('name');
    case 'website': return first('website_url');
    case 'industry': return first('industry', 'category', 'industry_list', 'category_list');
    case 'products_services': return first('products_services', 'products_services_list');
    case 'target_audience': return first('target_audience', 'target_customer_segment', 'target_audience_list');
    case 'ideal_customer_profile': return first('ideal_customer_profile');
    case 'unique_value': return first('unique_value', 'competitive_advantages');
    case 'brand_positioning': return first('brand_positioning');
    case 'brand_voice': return first('brand_voice', 'brand_voice_list');
    case 'geography': return first('geography', 'geography_list');
    case 'competitors': return first('competitors', 'competitors_list');
    case 'business_model': return first('pricing_model', 'sales_motion');
    case 'goals': return first('goals', 'growth_priorities', 'goals_list');
    case 'content_themes': return first('content_themes', 'content_themes_list');
    case 'social': {
      const socials = ['linkedin_url', 'facebook_url', 'instagram_url', 'x_url', 'youtube_url', 'tiktok_url'];
      const present = socials.filter((k) => str(g[k]));
      if (present.length) return present.map((k) => k.replace('_url', '')).join(', ');
      const arr = Array.isArray(g.social_profiles) ? (g.social_profiles as Array<{ platform?: string }>) : [];
      return arr.length ? arr.map((s) => str(s.platform)).filter(Boolean).join(', ') || null : null;
    }
    case 'team': return first();
    case 'core_problem': return first('core_problem_statement');
    case 'desired_transformation': return first('desired_transformation', 'life_after_solution');
    default: return null;
  }
}

/** Team size lives under report_settings.company_facts — resolved separately. */
function resolveTeam(p: CompanyProfile): string | null {
  return str(p.report_settings?.company_facts?.team_size) || null;
}

const bandToConfidence = (band: string | undefined): KnowledgeConfidence => {
  switch (String(band ?? '').toLowerCase()) {
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'low';
  }
};

/** Canonical column a node's confidence band is keyed under in field_confidence. */
const NODE_CONFIDENCE_KEY: Record<string, string> = {
  company: 'name', website: 'website_url', industry: 'industry', products_services: 'products_services',
  target_audience: 'target_audience', ideal_customer_profile: 'ideal_customer_profile', unique_value: 'unique_value',
  brand_positioning: 'brand_positioning', brand_voice: 'brand_voice', geography: 'geography', competitors: 'competitors',
  business_model: 'pricing_model', goals: 'goals', content_themes: 'content_themes', social: 'linkedin_url',
  team: 'team_size', core_problem: 'core_problem_statement', desired_transformation: 'desired_transformation',
};

// ── Build the graph ──────────────────────────────────────────────────────────

export interface CompanyKnowledgeGraph {
  nodes: KnowledgeNodeResolution[];
  byId: Record<string, KnowledgeNodeResolution>;
}

export function buildCompanyKnowledgeGraph(profile: CompanyProfile): CompanyKnowledgeGraph {
  const locked = new Set((profile.user_locked_fields ?? []).map((f) => String(f)));
  const fieldConf = profile.field_confidence ?? {};

  const nodes: KnowledgeNodeResolution[] = KNOWLEDGE_NODES.map((node) => {
    const resolvedValue = node.id === 'team' ? resolveTeam(profile) : resolveNodeValue(profile, node.id);
    const has = !!resolvedValue;
    const confKey = NODE_CONFIDENCE_KEY[node.id];
    const confidence: KnowledgeConfidence = has ? bandToConfidence(fieldConf[confKey]) : 'none';

    let state: KnowledgeState;
    let source: KnowledgeNodeResolution['source'];
    if (!has) { state = 'unknown'; source = 'unknown'; }
    else if (locked.has(confKey)) { state = 'confirmed'; source = 'user'; }
    else if (confidence === 'high') { state = 'observed'; source = 'profile'; }
    else { state = 'inferred'; source = 'inferred'; }

    const min = node.minConfidence ?? 'low';
    const satisfied = has && CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[min];

    return { id: node.id, label: node.label, section: node.section, value: node.value, state, confidence, source, resolvedValue, satisfied, question: node.question };
  });

  const byId: Record<string, KnowledgeNodeResolution> = {};
  for (const n of nodes) byId[n.id] = n;
  return { nodes, byId };
}

// ── Semantic deduplication ───────────────────────────────────────────────────

/** Resolve an arbitrary question/utterance to the knowledge node it satisfies (or null). */
export function resolveQuestionNode(text: string): string | null {
  const t = ` ${text.toLowerCase()} `;
  for (const node of KNOWLEDGE_NODES) {
    for (const keywords of node.equivalents) {
      if (keywords.every((k) => t.includes(k.toLowerCase()))) return node.id;
    }
  }
  return null;
}

/**
 * True if asking `questionText` is still useful — i.e. it does not map to a node
 * that is already satisfied. Equivalent phrasings of a satisfied node all return
 * false (never ask again).
 */
export function isQuestionEligible(graph: CompanyKnowledgeGraph, questionText: string): boolean {
  const nodeId = resolveQuestionNode(questionText);
  if (!nodeId) return true; // unrecognized → don't block
  return !graph.byId[nodeId]?.satisfied;
}

// ── Question governance ──────────────────────────────────────────────────────

export interface NextQuestion {
  nodeId: string;
  question: string;
  label: string;
  value: number;
}

/**
 * Ask the HIGHEST-VALUE unknown, never a satisfied node. Optional `sessionAsked`
 * (node ids asked but not yet answered this session) is de-prioritized so the
 * conversation advances instead of re-pressing the same gap.
 */
export function selectNextProfileQuestion(
  graph: CompanyKnowledgeGraph,
  opts: { sessionAsked?: string[]; exclude?: string[] } = {},
): NextQuestion | null {
  const asked = new Set(opts.sessionAsked ?? []);
  const exclude = new Set(opts.exclude ?? []);
  const candidates = graph.nodes
    .filter((n) => !n.satisfied && !exclude.has(n.id))
    .sort((a, b) => {
      // Prefer not-yet-asked-this-session, then by value.
      const aAsked = asked.has(a.id) ? 1 : 0;
      const bAsked = asked.has(b.id) ? 1 : 0;
      if (aAsked !== bAsked) return aAsked - bAsked;
      return b.value - a.value;
    });
  const pick = candidates[0];
  return pick ? { nodeId: pick.id, question: pick.question, label: pick.label, value: pick.value } : null;
}

// ── Readiness (derived from knowledge completeness, not question count) ───────

export interface ProfileKnowledgeReadiness {
  score: number;              // 0-100, value-weighted satisfied share
  satisfiedCount: number;
  totalCount: number;
  remainingGaps: string[];    // node ids still unknown, highest-value first
  enoughToProceed: boolean;   // true once the high-value core is satisfied
}

/** Nodes whose satisfaction constitutes "enough to stop interviewing". */
const CORE_NODE_IDS = ['company', 'website', 'industry', 'products_services', 'target_audience', 'unique_value'];

export function profileKnowledgeReadiness(graph: CompanyKnowledgeGraph): ProfileKnowledgeReadiness {
  const totalValue = graph.nodes.reduce((s, n) => s + n.value, 0);
  const satisfiedValue = graph.nodes.filter((n) => n.satisfied).reduce((s, n) => s + n.value, 0);
  const score = totalValue ? Math.round((satisfiedValue / totalValue) * 100) : 0;
  const satisfiedCount = graph.nodes.filter((n) => n.satisfied).length;
  const remainingGaps = graph.nodes
    .filter((n) => !n.satisfied)
    .sort((a, b) => b.value - a.value)
    .map((n) => n.id);
  const enoughToProceed = CORE_NODE_IDS.every((id) => graph.byId[id]?.satisfied);
  return { score, satisfiedCount, totalCount: graph.nodes.length, remainingGaps, enoughToProceed };
}

// ── Grounding: "what we already know" for prompt injection ────────────────────

/**
 * A compact "ALREADY KNOWN — never ask about these" block for grounding any
 * profile conversation prompt, plus the next highest-value gap. This is the
 * single canonical source both of what-is-known and what-to-ask-next.
 */
export function buildKnowledgeGrounding(graph: CompanyKnowledgeGraph): { known: string; nextQuestion: NextQuestion | null; readiness: ProfileKnowledgeReadiness } {
  const knownLines = graph.nodes
    .filter((n) => n.satisfied && n.resolvedValue)
    .map((n) => `- ${n.label}: ${n.resolvedValue} (${n.state})`);
  const known = knownLines.length
    ? `ALREADY KNOWN — never ask the user for any of these; treat as established:\n${knownLines.join('\n')}`
    : 'Nothing established yet.';
  return { known, nextQuestion: selectNextProfileQuestion(graph), readiness: profileKnowledgeReadiness(graph) };
}
