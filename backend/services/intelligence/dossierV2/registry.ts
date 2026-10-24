/**
 * Dossier v2 — the canonical findings and actions registry.
 *
 * WHY THIS EXISTS. The v1 dossier renders recommendations from seven generators that share no
 * identity: the digital-snapshot rules, the action playbook, the strategic playbook (the same
 * five actions again), the GEO "do now" list (three of them a third time), the digital-experience
 * findings, the improvement levers, and the four-state "fix first" block. The reader saw the same
 * move up to four times in different words.
 *
 * This module is the ONE place a recommendation becomes an action. Every generator's output is
 * read as a candidate; candidates that describe the same move merge into one action with a
 * stable id, and every merge is recorded so the de-duplication is auditable rather than claimed.
 * Nothing is invented: every field on an action comes from one of its source candidates.
 *
 * Findings are built the same way — one per underlying condition — and actions link to the
 * findings they address.
 */
import type { CanonicalExportPayload } from '../canonicalExport';
import { isBrandQuestion, isMarketingBasic, summariseVisibility, type ResearchPack, type ResearchRecord } from './research';

export type EvidenceState = 'measured' | 'inferred' | 'declared' | 'unavailable' | 'not_measured';
export type Effort = 'low' | 'medium' | 'high';
export type Level = 'low' | 'medium' | 'high';
export type Horizon = '0-30' | '31-60' | '61-90' | 'later';

export type ActionSource =
  | 'digital_snapshot'
  | 'action_playbook'
  | 'strategic_playbook'
  | 'geo_decision'
  | 'digital_experience'
  | 'improvement_lever'
  | 'evidence_coverage'
  | 'public_research';

export type DossierAction = {
  id: string;
  title: string;
  /** What to do, in one sentence, from the most specific source that said it. */
  action: string;
  pillar: string | null;
  effort: Effort | null;
  confidence: Level | null;
  horizon: Horizon | null;
  /** 'stated' when a source scheduled it; 'effort' when derived from effort (low→0-30, medium→31-60, high→61-90). */
  horizonBasis: 'stated' | 'effort' | null;
  /** 'improvement' changes the site; 'measurement' connects or establishes evidence. */
  kind: 'improvement' | 'measurement';
  /**
   * Expected business impact tier, from the source's own rating: playbook expected_impact,
   * snapshot impact (≥60 high, ≥35 medium), or a lever's projected index gain (≥5 high, ≥2
   * medium). Null when no source rated it; never guessed.
   */
  impact: Level | null;
  impactBasis: string | null;
  /** 0–100, from the source that scored it; null when no source did. */
  priority: number | null;
  priorityBasis: string | null;
  why: string | null;
  steps: string[];
  verification: string | null;
  owner: string | null;
  dependsOn: string[];
  findingIds: string[];
  evidence: Array<{ state: EvidenceState; statement: string }>;
  /** Score lever, when a source projected one. */
  lever: { dimension: string; now: number; target: number; overallGain: number; pillarGain: number } | null;
  sources: ActionSource[];
  /** Public-research evidence records (ids) this action rests on. */
  evidenceIds: string[];
  /** Every source title merged into this action, verbatim — the audit trail. */
  mergedTitles: string[];
};

export type DossierFinding = {
  id: string;
  title: string;
  pillar: string | null;
  kind: 'dimension' | 'content' | 'positioning' | 'search' | 'competitive' | 'coverage';
  state: EvidenceState;
  metric: string | null;
  observation: string;
  implication: string | null;
  source: string;
  actionIds: string[];
};

export type RegistryAudit = {
  candidates: number;
  actions: number;
  merges: Array<{ into: string; from: ActionSource; title: string }>;
  bySource: Record<ActionSource, number>;
};

export type DossierRegistry = {
  findings: DossierFinding[];
  actions: DossierAction[];
  audit: RegistryAudit;
};

// ── Text similarity ─────────────────────────────────────────────────────────

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'your', 'are', 'its', 'their', 'them',
  'around', 'across', 'more', 'most', 'make', 'build', 'improve', 'strengthen', 'so', 'to', 'of',
  'on', 'in', 'a', 'an', 'or', 'by', 'as', 'at', 'is', 'be', 'it', 'not', 'do', 'ones',
]);

export function tokens(text: string | null | undefined): Set<string> {
  return new Set(
    String(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .map((t) => t.replace(/(ing|es|s)$/, ''))
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  // Overlap coefficient: a short title fully contained in a longer one is the same move.
  return shared / Math.min(x.size, y.size);
}

/** Two candidates describe the same move. Tuned so restatements merge and distinct moves don't. */
export const SAME_ACTION_THRESHOLD = 0.6;

// ── Helpers over loosely typed payload surfaces ─────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const level = (v: unknown): Level | null => (v === 'low' || v === 'medium' || v === 'high' ? v : null);

function horizonOf(v: unknown): Horizon | null {
  const s = String(v ?? '');
  if (/^0-30|0–30/.test(s)) return '0-30';
  if (/31-60|31–60/.test(s)) return '31-60';
  if (/61-90|61–90/.test(s)) return '61-90';
  return null;
}

export function slug(text: string): string {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item';
}

// ── Candidates ──────────────────────────────────────────────────────────────

type Candidate = Omit<DossierAction, 'id' | 'sources' | 'mergedTitles' | 'findingIds' | 'dependsOn' | 'horizonBasis' | 'kind'> & {
  source: ActionSource;
  sourceId: string | null;
  dependsOnSourceIds: string[];
};

const blank = (source: ActionSource, title: string): Candidate => ({
  source, sourceId: null, title, action: title, pillar: null, effort: null, confidence: null,
  horizon: null, impact: null, impactBasis: null, priority: null, priorityBasis: null, why: null, steps: [], verification: null,
  owner: null, dependsOnSourceIds: [], evidence: [], evidenceIds: [], lever: null,
});

function snapshotCandidates(payload: CanonicalExportPayload): Candidate[] {
  const ds = obj(payload.report1?.digital_snapshot);
  if (!ds) return [];
  const items = [...arr(ds.topPriorities), ...arr(ds.opportunities)];
  const plan = obj(ds.plan);
  const planned = new Map<string, Horizon>();
  for (const [key, h] of [['days_0_30', '0-30'], ['days_31_60', '31-60'], ['days_61_90', '61-90']] as const) {
    for (const p of arr(plan?.[key])) {
      const t = str(obj(p)?.title);
      if (t) planned.set(t, h);
    }
  }
  return items.map((raw) => {
    const p = obj(raw) ?? {};
    const title = str(p.title) ?? 'Untitled priority';
    const c = blank('digital_snapshot', title);
    c.sourceId = str(p.id);
    c.action = str(p.action) ?? title;
    c.effort = level(p.effort);
    c.confidence = level(p.confidence);
    c.horizon = horizonOf(p.horizon) ?? planned.get(title) ?? null;
    const score = num(p.priorityScore);
    c.priority = score == null ? null : Math.round(score);
    const impact = num(p.impact);
    if (impact != null) {
      c.impact = impact >= 60 ? 'high' : impact >= 35 ? 'medium' : 'low';
      c.impactBasis = `snapshot impact ${impact}/100`;
    }
    c.priorityBasis = score == null ? null : 'impact × confidence ÷ effort (digital snapshot)';
    c.why = str(p.businessImplication) ?? str(p.problem);
    c.verification = str(p.measurement);
    c.evidence = arr(p.evidence).map((e) => {
      const o = obj(e) ?? {};
      const state = o.state === 'measured' ? 'measured' : o.state === 'inferred' ? 'inferred' : 'unavailable';
      return { state: state as EvidenceState, statement: str(o.statement) ?? '' };
    }).filter((e) => e.statement);
    return c;
  });
}

function playbookCandidates(payload: CanonicalExportPayload, source: 'action_playbook' | 'strategic_playbook'): Candidate[] {
  const pb = obj(source === 'action_playbook' ? payload.action_playbook : payload.strategic_playbook);
  return arr(pb?.actions).map((raw) => {
    const a = obj(raw) ?? {};
    const title = str(a.title) ?? 'Untitled action';
    const c = blank(source, title);
    c.sourceId = str(a.id);
    c.pillar = str(a.pillar);
    c.effort = level(a.effort);
    c.confidence = level(a.confidence);
    const leverage = num(a.leverage_score);
    c.impact = level(a.expected_impact);
    c.impactBasis = c.impact ? 'playbook expected impact' : null;
    c.priority = leverage;
    c.priorityBasis = leverage == null ? null : 'leverage score (strategic playbook)';
    c.why = str(a.reasoning);
    c.owner = str(a.owner_area);
    c.dependsOnSourceIds = [...arr(a.dependencies), ...arr(a.resolved_dependencies)]
      .map((d) => str(d) ?? str(obj(d)?.id)).filter((d): d is string => Boolean(d));
    const outcome = str(a.expected_outcome);
    if (outcome) c.verification = outcome;
    return c;
  });
}

function geoCandidates(payload: CanonicalExportPayload): Candidate[] {
  const d = obj(obj(payload.report1?.geo_evidence_decision)?.decision);
  return arr(d?.doNow).map((t) => str(t)).filter((t): t is string => Boolean(t)).map((title) => {
    const c = blank('geo_decision', title);
    c.pillar = 'discoverability';
    c.why = str(d?.why);
    return c;
  });
}

function experienceCandidates(payload: CanonicalExportPayload): Candidate[] {
  const de = obj(payload.report1?.digital_experience);
  return arr(de?.findings).map((raw) => {
    const f = obj(raw) ?? {};
    const title = str(f.problem) ?? 'Website finding';
    const c = blank('digital_experience', title);
    c.action = str(f.action) ?? title;
    c.effort = level(f.effort);
    c.why = str(f.whyItMatters);
    c.verification = str(f.measurement);
    const ev = str(f.evidence);
    if (ev) c.evidence = [{ state: 'measured', statement: ev }];
    return c;
  });
}

function leverCandidates(payload: CanonicalExportPayload): Candidate[] {
  return arr(payload.improvement_todos).map((raw) => {
    const t = obj(raw) ?? {};
    const dimension = str(t.dimension_label) ?? str(t.dimension) ?? 'dimension';
    const title = str(t.what) ?? `Improve ${dimension}`;
    const c = blank('improvement_lever', title);
    c.sourceId = str(t.dimension);
    c.pillar = str(t.pillar);
    c.effort = level(t.effort);
    c.confidence = level(t.confidence);
    c.owner = str(t.owner_area);
    c.steps = arr(t.how).map(str).filter((s): s is string => Boolean(s));
    const now = num(t.current_score);
    const target = num(t.target_score);
    const overall = num(t.projected_overall_gain);
    const pillarGain = num(t.projected_pillar_gain);
    if (now != null && target != null && overall != null && pillarGain != null) {
      c.lever = { dimension, now, target, overallGain: overall, pillarGain };
      c.impact = overall >= 5 ? 'high' : overall >= 2 ? 'medium' : 'low';
      c.impactBasis = `projected +${overall} Authority Index points`;
      c.why = `${dimension} reads ${now}/100; raising it to ${target} lifts the Authority Index by ${overall} points.`;
      c.verification = `Re-run the report and confirm ${dimension} reaches ${target}/100.`;
    }
    return c;
  });
}

function coverageCandidates(payload: CanonicalExportPayload): Candidate[] {
  return arr(obj(payload.report1?.evidence_coverage)?.gaps).map((raw) => {
    const g = obj(raw) ?? {};
    const area = str(g.area) ?? 'evidence';
    const c = blank('evidence_coverage', str(g.next_step) ?? `Connect a source for ${area}`);
    c.sourceId = `gap:${slug(area)}`;
    c.why = [str(g.impact), str(g.expected_benefit)].filter(Boolean).join(' ') || null;
    c.verification = `Regenerate the report and confirm ${area} reads as measured.`;
    c.effort = 'low';
    c.evidence = [{ state: 'unavailable', statement: str(g.why) ?? `${area} is not measured.` }];
    return c;
  });
}

// ── Merge ───────────────────────────────────────────────────────────────────

const SOURCE_RANK: Record<ActionSource, number> = {
  digital_snapshot: 0, strategic_playbook: 1, action_playbook: 2, digital_experience: 3, geo_decision: 4, improvement_lever: 5,
  evidence_coverage: 6,
  public_research: 7,
};

/**
 * A score lever restates an action when its own steps describe that action's move: a strong
 * match on its own, or a moderate match where the action also names the lever's dimension.
 * (Similarity alone cannot tell "strengthen entity mentions" ≈ Entity Graph Strength from
 * "build out commercial pages" ≈ Index Integrity — both score 0.43 on the omnivyra data.)
 */
export const LEVER_STRONG_MATCH = 0.6;
export const LEVER_NAMED_MATCH = 0.4;

function sameMove(a: Candidate | DossierAction, b: Candidate): boolean {
  if ('sourceId' in a && a.sourceId && b.sourceId && a.sourceId === b.sourceId) return true;
  const best = Math.max(
    similarity(a.title, b.title),
    similarity(a.action, b.action),
    similarity(a.title, b.action),
    similarity(a.action, b.title),
  );
  return best >= SAME_ACTION_THRESHOLD;
}

const first = <T>(...values: Array<T | null | undefined>): T | null => {
  for (const v of values) if (v != null && !(Array.isArray(v) && v.length === 0)) return v;
  return null;
};

export function buildActions(payload: CanonicalExportPayload): { actions: DossierAction[]; audit: RegistryAudit } {
  const all: Candidate[] = [
    ...snapshotCandidates(payload),
    ...playbookCandidates(payload, 'strategic_playbook'),
    ...playbookCandidates(payload, 'action_playbook'),
    ...experienceCandidates(payload),
    ...geoCandidates(payload),
  ];
  const levers = leverCandidates(payload);
  const coverage = coverageCandidates(payload);
  const bySource = Object.fromEntries(Object.keys(SOURCE_RANK).map((k) => [k, 0])) as Record<ActionSource, number>;
  const candidateCount = all.length + levers.length + coverage.length;
  for (const c of [...all, ...levers, ...coverage]) bySource[c.source] += 1;

  const groups: Array<{ members: Candidate[] }> = [];
  const merges: RegistryAudit['merges'] = [];
  for (const c of all) {
    const group = groups.find((g) => g.members.some((m) => sameMove(m, c)));
    if (group) group.members.push(c);
    else groups.push({ members: [c] });
  }
  // Levers attach to the action whose move their steps describe (one lever per action); a lever
  // that describes no existing action stands as its own action.
  const levered = new Set<(typeof groups)[number]>();
  for (const lever of levers) {
    const leverText = [lever.title, ...lever.steps].join(' ');
    const dimensionTokens = tokens(lever.lever?.dimension);
    let best: { group: (typeof groups)[number]; score: number } | null = null;
    for (const g of groups) {
      if (levered.has(g)) continue;
      const score = Math.max(...g.members.map((m) => similarity(m.title, leverText)));
      const named = g.members.some((m) => [...tokens(`${m.title} ${m.why ?? ''}`)].some((t) => dimensionTokens.has(t)));
      const attaches = score >= LEVER_STRONG_MATCH || (score >= LEVER_NAMED_MATCH && named);
      if (attaches && (!best || score > best.score)) best = { group: g, score };
    }
    if (best) { best.group.members.push(lever); levered.add(best.group); } else groups.push({ members: [lever] });
  }
  for (const c of coverage) groups.push({ members: [c] });

  const sourceIdToAction = new Map<string, string>();
  const used = new Set<string>();
  const actions: DossierAction[] = groups.map((g) => {
    const members = [...g.members].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
    const lead = members[0];
    let id = actionId(lead);
    for (let n = 2; used.has(id); n += 1) id = `${actionId(lead)}-${n}`;
    used.add(id);
    for (const m of members) {
      if (m.sourceId) sourceIdToAction.set(m.sourceId, id);
      if (m !== lead) merges.push({ into: id, from: m.source, title: m.title });
    }
    const pick = <K extends keyof Candidate>(key: K) => first(...members.map((m) => m[key] as never)) as Candidate[K] | null;
    const evidence: DossierAction['evidence'] = [];
    for (const m of members) for (const e of m.evidence) if (!evidence.some((x) => x.statement === e.statement)) evidence.push(e);
    return {
      id,
      title: lead.title,
      action: lead.action !== lead.title ? lead.action : (pick('action') ?? lead.title),
      pillar: pick('pillar'),
      effort: pick('effort'),
      confidence: pick('confidence'),
      horizon: pick('horizon') ?? horizonFromEffort(pick('effort')),
      horizonBasis: pick('horizon') ? 'stated' : pick('effort') ? 'effort' : null,
      kind: lead.source === 'evidence_coverage' ? 'measurement' : 'improvement',
      impact: pick('impact'),
      impactBasis: pick('impact') ? (members.find((m) => m.impact)?.impactBasis ?? null) : null,
      priority: lead.priority ?? pick('priority'),
      priorityBasis: lead.priority != null ? lead.priorityBasis : pick('priorityBasis'),
      why: pick('why'),
      steps: pick('steps') ?? [],
      verification: pick('verification'),
      owner: pick('owner'),
      dependsOn: [],
      findingIds: [],
      evidence,
      lever: pick('lever'),
      sources: [...new Set(members.map((m) => m.source))],
      mergedTitles: [...new Set(members.map((m) => m.title))],
      evidenceIds: [],
      _deps: members.flatMap((m) => m.dependsOnSourceIds),
    } as DossierAction & { _deps: string[] };
  });

  for (const a of actions as Array<DossierAction & { _deps?: string[] }>) {
    a.dependsOn = [...new Set((a._deps ?? []).map((d) => sourceIdToAction.get(d)).filter((d): d is string => Boolean(d) && d !== a.id))];
    delete a._deps;
  }
  alignDerivedWindows(actions);

  actions.sort((a, b) => (a.kind === b.kind ? rankValue(b) - rankValue(a) : a.kind === 'improvement' ? -1 : 1));
  return { actions, audit: { candidates: candidateCount, actions: actions.length, merges, bySource } };
}

function horizonFromEffort(effort: Effort | null): Horizon | null {
  return effort === 'low' ? '0-30' : effort === 'medium' ? '31-60' : effort === 'high' ? '61-90' : null;
}

/**
 * Stable, readable id: the producer's own id when it has one, else the title, with producer
 * prefixes ("geo_aeo:", "seo:") dropped and cut to the first four significant words. The same
 * finding text yields the same id on every run.
 */
function actionId(lead: { sourceId: string | null; title: string }): string {
  if (lead.sourceId?.startsWith('gap:')) return `A-gap-${lead.sourceId.slice(4)}`;
  const base = String(lead.sourceId ?? lead.title).replace(/^[a-z_]+:/i, '');
  // Whole words (not the stemmed matching tokens), so ids read as words.
  const words = base.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').split(/[\s_-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 4);
  // Cut at a word boundary, never mid-word.
  let id = '';
  for (const w of words) { if (id && `${id}-${w}`.length > 30) break; id = id ? `${id}-${w}` : w; }
  return `A-${id || slug(base).slice(0, 30)}`;
}

const WINDOW_ORDER: Horizon[] = ['0-30', '31-60', '61-90', 'later'];

/**
 * A window derived from effort may not precede its prerequisite's window: the dependant moves to
 * the prerequisite's window. A window a source STATED is never moved; a conflict there stays
 * visible in the register.
 */
function alignDerivedWindows(actions: DossierAction[]): void {
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (let pass = 0; pass < actions.length; pass += 1) {
    let moved = false;
    for (const a of actions) {
      if (a.horizonBasis !== 'effort' || !a.horizon) continue;
      for (const dep of a.dependsOn) {
        const d = byId.get(dep);
        if (d?.horizon && WINDOW_ORDER.indexOf(d.horizon) > WINDOW_ORDER.indexOf(a.horizon)) {
          a.horizon = d.horizon;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Ranking. Sources score on different scales, so the register orders by the source score where
 * one exists, breaking ties toward lower effort and higher confidence. A lever-only action ranks
 * by its projected overall gain. Stated in the report next to the register.
 */
export function rankValue(a: DossierAction): number {
  const effort = a.effort === 'low' ? 3 : a.effort === 'high' ? 1 : 2;
  const conf = a.confidence === 'high' ? 3 : a.confidence === 'low' ? 1 : 2;
  const base = a.priority ?? (a.lever ? a.lever.overallGain * 5 : 0);
  return base * 10 + effort + conf;
}

// ── Findings ────────────────────────────────────────────────────────────────

const WEAK_BELOW = 50;

export function buildFindings(payload: CanonicalExportPayload): DossierFinding[] {
  const findings: DossierFinding[] = [];
  const push = (f: Omit<DossierFinding, 'actionIds'>) => {
    if (!findings.some((x) => x.id === f.id)) findings.push({ ...f, actionIds: [] });
  };

  for (const p of arr(payload.pillars)) {
    const pillar = obj(p) ?? {};
    for (const d of arr(pillar.dimensions)) {
      const dim = obj(d) ?? {};
      const score = obj(dim.score) ?? {};
      const value = num(score.value);
      const state = String(score.state ?? '');
      if (value == null || value >= WEAK_BELOW || (state !== 'measured' && state !== 'inferred')) continue;
      const label = str(dim.label) ?? str(dim.key) ?? 'Dimension';
      push({
        id: `F-dim-${slug(String(dim.key ?? label))}`,
        title: `${label} is low`,
        pillar: str(pillar.pillar),
        kind: 'dimension',
        state: state === 'measured' ? 'measured' : 'inferred',
        metric: `${value}/100`,
        observation: str(dim.rationale) ?? `${label} reads ${value}/100.`,
        implication: `${str(pillar.label) ?? 'This pillar'} is held back while ${label} stays below ${WEAK_BELOW}.`,
        source: 'Authority scoring (site crawl)',
      });
    }
  }

  for (const raw of arr(obj(payload.report1?.digital_experience)?.findings)) {
    const f = obj(raw) ?? {};
    const title = str(f.problem);
    if (!title) continue;
    push({
      id: `F-web-${slug(title)}`,
      title,
      pillar: 'foundation',
      kind: 'content',
      state: 'measured',
      metric: str(f.evidence),
      observation: str(f.evidence) ?? title,
      implication: str(f.whyItMatters),
      source: 'Website crawl',
    });
  }

  for (const raw of arr(obj(payload.report1?.company_identity)?.fields)) {
    const f = obj(raw) ?? {};
    if (f.agreement !== 'differ') continue;
    push({
      id: `F-identity-${slug(String(f.key ?? 'field'))}`,
      title: `Declared and published ${String(f.label ?? 'positioning').toLowerCase()} differ`,
      pillar: 'trust',
      kind: 'positioning',
      state: 'measured',
      metric: null,
      observation: `Declared: "${str(f.declaredValue) ?? '—'}". Website: "${str(f.observedValue) ?? '—'}".`,
      implication: 'Buyers and answer engines read the website, so the declared positioning is not what they encounter.',
      source: 'Company profile vs website crawl',
    });
  }

  const sv = obj(payload.report1?.search_visibility);
  if (sv && num(sv.queriesRun) && num(sv.queriesRanked) === 0) {
    push({
      id: 'F-search-not-found',
      title: 'Domain absent from the checked search results',
      pillar: 'discoverability',
      kind: 'search',
      state: 'measured',
      metric: `0 of ${num(sv.queriesRun)} queries`,
      observation: str(sv.reason) ?? 'The domain did not appear in the results checked.',
      implication: 'Read with the query set: a small or generic query set is weak evidence about commercial visibility.',
      source: 'Public search results (SerpAPI)',
    });
  }

  const ct = obj(payload.report1?.competitive_tables);
  if (ct?.empty) {
    push({
      id: 'F-competitors-unresolved',
      title: 'No competitor set could be established',
      pillar: null,
      kind: 'competitive',
      state: 'not_measured',
      metric: null,
      observation: str(ct.emptyReason) ?? 'No competitors were discovered.',
      implication: 'Positioning, pricing and share-of-visibility comparisons are held open until a competitor set exists.',
      source: 'Competitor discovery',
    });
  }

  for (const raw of arr(obj(payload.report1?.evidence_coverage)?.gaps)) {
    const g = obj(raw) ?? {};
    const area = str(g.area);
    if (!area) continue;
    push({
      id: `F-gap-${slug(area)}`,
      title: `${area} not measured`,
      pillar: null,
      kind: 'coverage',
      state: 'unavailable',
      metric: null,
      observation: str(g.why) ?? `${area} has no connected source.`,
      implication: str(g.impact),
      source: 'Evidence coverage',
    });
  }
  return findings;
}

/** Link actions to the findings they address (pillar match + shared subject terms). */
export function linkFindings(findings: DossierFinding[], actions: DossierAction[]): void {
  for (const a of actions) {
    // Links declared by the producer (research actions name their findings) are kept both ways.
    for (const id of a.findingIds) { const f = findings.find((x) => x.id === id); if (f && !f.actionIds.includes(a.id)) f.actionIds.push(a.id); }
    const text = [a.title, a.action, a.why, ...a.evidence.map((e) => e.statement), a.lever?.dimension].join(' ');
    for (const f of findings) {
      if (a.kind === 'measurement') {
        // A measurement action addresses the gap it was built from, and the findings that
        // gap leaves unresolved in the same area.
        const area = a.id.replace(/^A-gap-/, '');
        if (f.kind === 'coverage' && f.id === `F-gap-${area}`) { a.findingIds.push(f.id); f.actionIds.push(a.id); }
        continue;
      }
      if (f.kind === 'coverage') continue;
      const dimMatch = a.lever && f.kind === 'dimension' && f.title.startsWith(a.lever.dimension);
      const textMatch = similarity(`${f.title} ${f.observation}`, text) >= 0.35 && (!f.pillar || !a.pillar || f.pillar === a.pillar || f.kind !== 'dimension');
      if (dimMatch || textMatch) {
        if (!a.findingIds.includes(f.id)) a.findingIds.push(f.id);
        if (!f.actionIds.includes(a.id)) f.actionIds.push(a.id);
      }
    }
  }
}

export function buildDossierRegistry(payload: CanonicalExportPayload, research: ResearchPack | null = null): DossierRegistry {
  const { actions, audit } = buildActions(payload);
  for (const a of actions) a.evidenceIds ??= [];
  const findings = buildFindings(payload);
  if (research) addResearch(research, findings, actions, audit);
  linkFindings(findings, actions);
  completeFromFindings(findings, actions);
  return { findings, actions, audit };
}

/** Coverage-gap action a research gap belongs to, by subject. */
const GAP_ROUTES: Array<[RegExp, string]> = [
  [/backlink/i, 'A-gap-backlink-authority'],
  [/generative|perplexity|ai search|ai visibility/i, 'A-gap-ai-visibility'],
  [/review|reputation|independent proof/i, 'A-gap-trust-reputation'],
];

/**
 * Public research joins the SAME registry. Its observations become findings; the conditions it
 * establishes become actions only where the evidence supports one; its gaps attach to the
 * matching measurement action, or become one. Every addition is counted in the audit.
 */
export function addResearch(pack: ResearchPack, findings: DossierFinding[], actions: DossierAction[], audit: RegistryAudit): void {
  const base = (over: Partial<DossierAction> & Pick<DossierAction, 'id' | 'title' | 'action' | 'kind'>): DossierAction => ({
    pillar: null, effort: null, confidence: null, horizon: null, horizonBasis: null, impact: null, impactBasis: null,
    priority: null, priorityBasis: null, why: null, steps: [], verification: null, owner: null, dependsOn: [],
    findingIds: [], evidence: [], lever: null, sources: ['public_research'], evidenceIds: [], mergedTitles: [over.title], ...over,
  });
  const add = (a: DossierAction) => {
    if (actions.some((x) => x.id === a.id)) return;
    actions.push(a);
    audit.candidates += 1;
    audit.actions += 1;
    audit.bySource.public_research = (audit.bySource.public_research ?? 0) + 1;
  };

  const search = pack.search.filter((r) => r.status === 'observed');
  const nonBranded = search.filter((r) => r.intent !== 'branded');
  const foundNonBranded = nonBranded.filter((r) => r.ownPosition != null).length;
  if (nonBranded.length) {
    findings.push({
      id: 'F-research-search', title: `Found for ${foundNonBranded} of ${nonBranded.length} non-branded buyer searches`, pillar: 'discoverability',
      kind: 'search', state: 'measured', metric: `${foundNonBranded} of ${nonBranded.length}`,
      observation: `Google, ${search[0]?.geography ?? 'unrecorded geography'}, ${search[0]?.language ?? ''}, ${search[0]?.observedAt?.slice(0, 10) ?? ''}: omnivyra.com ${foundNonBranded ? 'appeared for' : 'did not appear within the results returned for'} category, problem, commercial, use-case and comparison queries.`,
      implication: 'Buyers who search for the problem or the category, rather than the brand, do not currently find the site in the results checked.',
      source: `Public research ${pack.collectedAt} (${nonBranded.map((r) => r.id).slice(0, 3).join(', ')}…)`, actionIds: [],
    });
  }

  const collision = pack.independent.find((r) => r.kind === 'name_collision' && r.status === 'observed');
  if (collision) {
    findings.push({
      id: 'F-research-name-collision', title: 'The brand name is ambiguous in search', pillar: 'authority', kind: 'search', state: 'measured',
      metric: null, observation: collision.claim, implication: 'Someone who hears the name and searches for it may not find the company.',
      source: `Public research ${pack.collectedAt} (${collision.id})`, actionIds: [],
    });
    add(base({
      id: 'A-brand-name-unambiguous', kind: 'improvement', pillar: 'authority', effort: 'low', confidence: 'medium',
      horizon: horizonFromEffort('low'), horizonBasis: 'effort',
      title: 'Make the brand name unambiguous in search',
      action: `Pair "${pack.subject.brand}" with its category in page titles, Organization structured data and every public profile, so engines can tell it apart from similarly spelled names.`,
      why: collision.claim, verification: `A plain "${pack.subject.brand}" search (same engine and geography) returns ${pack.subject.domain} within the results checked.`,
      evidenceIds: [collision.id], findingIds: ['F-research-name-collision'],
    }));
  }

  const notFound = pack.independent.filter((r) => r.status === 'looked_for_not_found');
  if (notFound.length) {
    findings.push({
      id: 'F-research-no-independent-proof', title: 'No independent mention or listing was found', pillar: 'trust', kind: 'search', state: 'measured',
      metric: null, observation: notFound.map((r) => r.claim).join(' '),
      implication: 'Buyers and AI tools look for third-party confirmation; none was found in the searches made. This is not proof that none exists.',
      source: `Public research ${pack.collectedAt} (${notFound.map((r) => r.id).join(', ')})`, actionIds: [],
    });
  }

  // What AI search tools say: buyer questions (is the brand named?) and brand-name questions (is it right?).
  const vis = summariseVisibility(pack).generative;
  if (vis && vis.buyerAnswers) {
    const ids = pack.generative.filter((r) => r.status === 'observed' && r.query && !isBrandQuestion(r, pack.subject.brand)).map((r) => r.id);
    findings.push({
      id: 'F-research-ai-answers', title: `Named in ${vis.buyerNamed} of ${vis.buyerAnswers} AI answers to buyer questions`, pillar: 'discoverability', kind: 'search', state: 'measured',
      metric: `${vis.buyerNamed} of ${vis.buyerAnswers}`,
      observation: `${vis.surfaces.join(', ')} answered buyer questions from live web sources; ${pack.subject.brand} was named in ${vis.buyerNamed}.${vis.brandAnswers ? ` Asked by name, ${vis.brandCorrect} of ${vis.brandAnswers} answers described the company correctly and ${vis.brandMisidentified} confused it with something else.` : ''}`,
      implication: 'A buyer who asks an AI tool a category question is shown the brands its sources discuss; this company is not among them yet.',
      source: `Public research ${pack.collectedAt} (${ids.slice(0, 3).join(', ')}…)`, actionIds: [],
    });
  }

  // Own-site basics and competitor benchmark: findings, and the actions their evidence supports.
  const site = pack.site ?? [];
  const benchmark = pack.benchmark ?? [];
  const siteIssues = site.filter((r) => r.recommends);
  if (siteIssues.length) {
    findings.push({
      id: 'F-research-site-basics', title: 'Basic crawl and entity signals are missing', pillar: 'foundation', kind: 'search', state: 'measured',
      metric: `${siteIssues.length} gaps`, observation: siteIssues.map((r) => r.claim).join('. ') + '.',
      implication: 'Search engines and AI crawlers read these files and tags first; without them the site is harder to crawl completely and to recognise as one company.',
      source: `Direct fetch ${pack.collectedAt} (${siteIssues.map((r) => r.id).join(', ')})`, actionIds: [],
    });
  }
  const stale = site.find((r) => r.kind === 'content_cadence');
  const velocity = actions.find((a) => a.id === 'A-authority-velocity');
  if (stale && velocity && !velocity.evidenceIds.includes(stale.id)) velocity.evidenceIds.push(stale.id);
  const basics = benchmark.filter(isMarketingBasic);
  const behind = basics.filter((r) => r.values && Object.entries(r.values)[0]?.[1].status === 'looked_for_not_found');
  if (basics.length) {
    findings.push({
      id: 'F-research-competitor-benchmark', title: `Behind the validated competitors on ${behind.length} of ${basics.length} marketing basics`,
      pillar: 'authority', kind: 'competitive', state: 'measured', metric: null,
      observation: behind.map((r) => `${r.claim}: ${Object.values(r.values ?? {})[0]?.value}`).join('; ') + '.',
      implication: 'Competitors give buyers, review sites and AI tools more to find, cite and trust.',
      source: `Public research ${pack.collectedAt} (${benchmark.map((r) => r.id).join(', ')})`, actionIds: [],
    });
  }
  const recs = new Map<string, { rec: NonNullable<ResearchRecord['recommends']>; ids: string[] }>();
  for (const r of [...site, ...benchmark]) {
    if (!r.recommends) continue;
    const entry = recs.get(r.recommends.id) ?? { rec: r.recommends, ids: [] };
    entry.ids.push(r.id);
    recs.set(r.recommends.id, entry);
  }
  for (const { rec, ids } of recs.values()) {
    add(base({
      id: rec.id, kind: 'improvement', title: rec.title, action: rec.action, effort: rec.effort, impact: rec.impact ?? null,
      impactBasis: rec.impact ? 'analyst rating from public research' : null, pillar: rec.pillar ?? null, confidence: 'medium',
      horizon: horizonFromEffort(rec.effort), horizonBasis: 'effort', verification: rec.verification,
      why: [...site, ...benchmark].filter((r) => ids.includes(r.id)).map((r) => r.claim).slice(0, 2).join('; '),
      evidenceIds: ids,
      findingIds: rec.id === 'A-site-crawl-basics' ? ['F-research-site-basics'] : rec.id === 'A-ai-cited-sources' ? ['F-research-ai-answers'] : ['F-research-competitor-benchmark'],
    }));
  }

  for (const g of pack.gaps) {
    const route = GAP_ROUTES.find(([re]) => re.test(g.claim));
    const target = route ? actions.find((a) => a.id === route[1]) : null;
    if (target) {
      if (!target.steps.includes(g.method)) target.steps.push(g.method);
      if (!target.evidenceIds.includes(g.id)) target.evidenceIds.push(g.id);
      if (!target.sources.includes('public_research')) target.sources.push('public_research');
      audit.candidates += 1;
      audit.merges.push({ into: target.id, from: 'public_research', title: g.claim });
      continue;
    }
    add(base({
      id: `A-gap-${slug(g.claim).split('-').slice(0, 4).join('-')}`, kind: 'measurement', effort: 'low', horizon: '0-30', horizonBasis: 'effort',
      title: `Measure: ${g.claim}`, action: g.method, why: 'An evidence gap left open by the public research.',
      verification: 'The next report records an observation for this gap, with source and date.', evidenceIds: [g.id],
    }));
  }
  // Research findings point at the existing actions that address them (when present).
  const LINKS: Array<[string, string[]]> = [
    ['F-research-search', ['A-content-search-foundation', 'A-comparison-decision-pages']],
    ['F-research-no-independent-proof', ['A-proof-unified-driven-platform', 'A-gap-trust-reputation']],
    ['F-competitors-unresolved', ['A-gap-competitor-pricing-feature-matrix']],
    ['F-search-not-found', ['A-content-search-foundation']],
    ['F-research-ai-answers', ['A-gap-ai-visibility']],
    ['F-research-competitor-benchmark', ['A-gap-trust-reputation', 'A-authority-velocity']],
  ];
  for (const [fid, aids] of LINKS) {
    for (const aid of aids) {
      const a = actions.find((x) => x.id === aid);
      if (a && findings.some((f) => f.id === fid) && !a.findingIds.includes(fid)) a.findingIds.push(fid);
    }
  }
  actions.sort((a, b) => (a.kind === b.kind ? rankValue(b) - rankValue(a) : a.kind === 'improvement' ? -1 : 1));
}

/**
 * Fill the two fields a source left empty, only from evidence already on the action:
 *   pillar — from the finding it addresses;
 *   verification — from the score its own reasoning names ("Citation readiness scores 0/100").
 */
export function completeFromFindings(findings: DossierFinding[], actions: DossierAction[]): void {
  for (const a of actions) {
    if (!a.pillar) {
      const f = findings.find((x) => a.findingIds.includes(x.id) && x.pillar);
      if (f) a.pillar = f.pillar;
    }
    if (!a.verification && a.why) {
      const m = /([A-Z][A-Za-z -]{2,40}?) (?:scores|reads) (\d{1,3})\/100/.exec(a.why);
      if (m) a.verification = `Re-run the report and confirm ${m[1].trim().toLowerCase()} rises above ${m[2]}/100.`;
    }
  }
}
