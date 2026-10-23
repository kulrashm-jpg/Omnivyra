/**
 * PI-WP-C1 — Scoring Consolidation guard.
 *
 * The standing decision is that `backend/services/leadUnderstanding/engines/**`
 * is the canonical lead/prospect scorer. Today that decision is held by
 * CONVENTION ONLY: nothing stops a fourteenth lead-score formula appearing, and
 * nothing records the thirteen that already exist. This file is the mechanism.
 *
 * It is a RATCHET, not a refactor. It asserts nothing about whether a competing
 * scorer is right or wrong — only that the inventory is exactly what the C1
 * audit found. A new scorer fails the build; retiring one is a deliberate,
 * reviewable edit to a list, which is precisely the consumer proof the C1
 * retirement plan requires (see
 * docs/pmo/prospect-intelligence/PI-WP-C1-SCORING-CONSOLIDATION-001.md).
 *
 * It deliberately does NOT assert canonical adoption. Adoption is C2+ work and
 * gated on evidence the platform does not yet capture; a guard demanding it
 * would fail today for reasons no engineer could fix.
 */

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');

/** Directories scanned. `scripts/` and `pages/` are excluded: they orchestrate, they do not define formulas. */
const SCANNED_ROOTS = ['backend/services', 'backend/apiHandlers', 'lib'];

/**
 * The lead-signal score vocabulary. Narrow ON PURPOSE — these six column names
 * belong to the lead/prospect domain and nothing else, so the detector cannot
 * drift into the report, content or campaign scoring domains, which are
 * separately governed and are NOT this package's concern.
 *
 * `lead_score`, `overall_score`, `fit_score` and `priority_score` are omitted:
 * they are each used by unrelated domains, and a guard that fires on unrelated
 * work is a guard that gets deleted.
 */
const LEAD_SCORE_KEY = /^\s*(intent_score|icp_score|urgency_score|total_score|qualification_score|thread_lead_score)\s*:/m;

/**
 * Every file that CONSTRUCTS a lead-domain score object, as found by the C1
 * audit at commit 6ad638dd. Grouped by the role the audit assigned it, because
 * the retirement plan treats the groups very differently.
 */
const SCORE_WRITER_INVENTORY: readonly string[] = [
  // ── Producers: they compute a number that did not exist before. ──────────
  'backend/services/leadQualifier.ts',              // LLM: 0.4 icp + 0.3 urgency + 0.3 intent
  'backend/services/leadPredictiveQualifier.ts',    // LLM: 0.35/0.25/0.25 + trend velocity
  'backend/services/leadJobProcessor.ts',           // re-combines both of the above + platform weight
  'backend/services/leadDetectionService.ts',       // regex patterns + intent bonus + sentiment
  'backend/services/listeningSignalPipeline.ts',    // keyword density + length heuristic
  'backend/services/communitySignalService.ts',     // hardcoded 60 for competitor mentions
  'backend/services/crmIngestionService.ts',        // revenue/100 clamped to 40..100
  'backend/services/leadThreadScoring.ts',          // thread rollup over lead_signals
  'backend/services/leadClusterService.ts',         // cluster priority over lead_signals
  'backend/services/riskAssessor.ts',

  // ── Pass-through writers: they persist a score they did not compute. ─────
  'backend/services/canonicalLeadSignalService.ts', // THE single writer of lead_signals
  'lib/leadIntelligence/legacySignal.ts',

  // ── Re-derivers: they read a stored score and rescale or default it. ─────
  'backend/services/leadIntelligenceService.ts',    // DEFECT: invents 35 for an unscored lead
  'backend/services/distributionIntelligenceService.ts',
  'backend/services/advancedRevenueAttributionIntelligenceService.ts',
  'backend/services/buyerIntentIntelligenceService.ts',
  'backend/services/marketPulseAggregationService.ts',
  'backend/services/opportunityFeedService.ts',

  // ── Adjacent domain that shares the column name only. ────────────────────
  'backend/services/creator/companyStrategyRecommendationEngine.ts',
];

/**
 * The two rival five-dimension qualification CONTRACTS. Both score the same
 * lead, both persist into the SAME `lead_intelligence_profiles.intelligence`
 * row, and they weight the dimensions differently — so the two bands they
 * publish can disagree for one lead. Frozen here so a third cannot appear.
 */
const RIVAL_WEIGHT_TABLES: readonly string[] = [
  'backend/services/leadIntelligenceEngine/engineConfig.ts',   // intent .35 persona .15 companyFit .20 behavior .20 urgency .10
  'backend/services/qualificationPlanning/planningConfig.ts',  // intent .30 persona .15 companyFit .20 behavioralFit .15 urgency .20
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(full, out);
    } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const scanned = SCANNED_ROOTS.flatMap((r) => walk(path.join(REPO, r)));
const rel = (p: string): string => path.relative(REPO, p).split(path.sep).join('/');

describe('PI-WP-C1 — one canonical scoring path', () => {
  it('the scanned roots actually exist (a silent empty scan would pass everything)', () => {
    for (const root of SCANNED_ROOTS) {
      expect(fs.existsSync(path.join(REPO, root))).toBe(true);
    }
    expect(scanned.length).toBeGreaterThan(500);
  });

  it('no lead-score formula exists outside the audited inventory', () => {
    const found = scanned
      .filter((f) => LEAD_SCORE_KEY.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .sort();

    const unaudited = found.filter((f) => !SCORE_WRITER_INVENTORY.includes(f));

    // A new entry here means a FOURTEENTH lead-scoring path was introduced.
    // Before adding it to the inventory, establish why the canonical scorer
    // (`leadUnderstanding/engines/**`) could not express it — that reason is
    // the finding, and it belongs in PI-WP-C1-SCORING-CONSOLIDATION-001.md.
    expect(unaudited).toEqual([]);
  });

  it('every inventoried scorer still exists (a retirement must be recorded, not silent)', () => {
    const missing = SCORE_WRITER_INVENTORY.filter((f) => !fs.existsSync(path.join(REPO, f)));
    // If a file was legitimately retired, delete its line above IN THE SAME
    // commit and record the consumer proof in the C1 document. Retirement
    // without consumer proof is exactly what this package forbids.
    expect(missing).toEqual([]);
  });

  it('exactly two rival five-dimension qualification contracts exist, and no third', () => {
    // Narrow to the LEAD qualification vocabulary. A weight table is only a
    // rival if it weights `persona` — content/context/creator quality engines
    // also have `DIMENSION_WEIGHTS`, and they score a different thing entirely.
    const DECLARES_WEIGHTS = /(export const DIMENSION_WEIGHTS|weights:\s*\{[^}]*persona)/;
    const found = scanned
      .filter((f) => {
        const r = rel(f);
        if (r.startsWith('backend/services/leadUnderstanding/')) return false; // the canonical one
        const src = fs.readFileSync(f, 'utf8');
        return DECLARES_WEIGHTS.test(src) && src.includes('companyFit');
      })
      .map(rel)
      .sort();

    expect(found).toEqual([...RIVAL_WEIGHT_TABLES].sort());
  });

  it('the canonical dimension vocabulary is declared exactly once', () => {
    const declarers = scanned
      .filter((f) => /export const SCORE_DIMENSIONS\b/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);

    // A second declaration is how one platform comes to have two answers for
    // "which dimensions exist". The canonical five live in leadUnderstanding.
    expect(declarers).toEqual(['backend/services/leadUnderstanding/types.ts']);
  });
});
