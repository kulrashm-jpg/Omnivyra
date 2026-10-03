/**
 * WP-13 — the structural fence for the competitive-evidence null contract.
 *
 * WHY A SOURCE-TEXT RULE AND NOT A TYPE. This repository compiles with `"strict": false`
 * (tsconfig.json), so `null` is assignable to `number` and `strictNullChecks` is off. WP-13
 * measured that `x ?? 0` is well-typed under EVERY compiler setting and every type shape, so
 * no compiler configuration and no type declaration can bind this contract. Five instances of
 * the same defect have now been found and closed in five different files (WP-12 ×2, WP-15,
 * WP-17/18, WP-13) — each one a different module reaching for a different nullable field. The
 * behavioural suites pin each site; nothing pins the next file.
 *
 * WHY THIS RULE IS NARROW ON PURPOSE. It does NOT prohibit `?? 0`. Counting `?? 0` would fire
 * on `decision.confidence_score ?? 0` and `decision.effort_score ?? 0` in actionHelpers.ts —
 * decision-prioritisation inputs that are outside the competitive-evidence contract and are
 * correct as written — and the rule would be deleted within a week, as it should be. What is
 * forbidden here is zero-defaulting a SPECIFICALLY NAMED field that the repository itself
 * declares `number | null` BECAUSE it may never be observed, inside the modules that produce
 * comparative claims. The forbidden set is a declaration, not a syntax class.
 *
 * WHAT IT DOES NOT COVER, stated plainly: a new nullable dimension nobody adds to these lists
 * is not fenced. This is a regression fence for a measured, enumerated defect class, not a
 * detector for the next one.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * The modules that PRODUCE a competitive comparison. Renderers are deliberately excluded:
 * they re-read values that are already non-nullable on the persisted wire, where `?? 0` is a
 * defensive default rather than a collapse of unavailable evidence.
 */
const COMPARISON_PRODUCER_FILES = [
  'backend/services/competitor/competitorMetricsEvidence.ts',
  'backend/services/competitor/competitorMetricsTypes.ts',
  'backend/services/reportCompetitorIntelligenceServiceEngine.ts',
  'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
  'backend/services/reportCompetitorIntelligenceServiceModel.ts',
  'backend/services/snapshotReport/competitorSummaryHelpers.ts',
  'backend/services/snapshotReport/visualIntelligenceHelpers.ts',
  'backend/services/snapshotReport/actionHelpers.ts',
  'pages/api/reports/reportViewUtils.ts',
];

/**
 * `ComparisonMetrics` declares exactly these three `number | null`, with the stated reason that
 * no page crawl can establish them on EITHER side. They are null on every real report.
 */
const UNOBSERVABLE_COMPARISON_DIMENSIONS = [
  'publishing_frequency',
  'engagement_score',
  'geo_presence',
];

/**
 * The company-side radar axes. Every one is declared `number | null` in snapshotReportTypes.ts
 * and carries a sibling availability tag (`data_source_strength`, `axis_states`) in the same
 * payload, so the producer has already said when it was never observed.
 */
const NULLABLE_COMPANY_RADAR_AXES = [
  'content_quality_score',
  'keyword_research_score',
  'backlinks_score',
  'technical_seo_score',
  'rank_tracking_score',
  'competitor_intelligence_score',
  'answer_coverage_score',
];

/**
 * Comments MUST be stripped before scanning. Every one of these files documents the forbidden
 * expressions at length in prose — `visualIntelligenceHelpers.ts` and `actionHelpers.ts` quote
 * `Number(deltas.<dim> ?? 0)` verbatim in the comment explaining why it was removed. Without
 * stripping, this tripwire fails on its own rationale.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, (line) => {
    const index = line.indexOf('//');
    return line.slice(0, index);
  });
}

type Rule = { name: string; pattern: RegExp; why: string };

const RULES: Rule[] = [
  {
    name: 'no zero-default on an unobservable comparison dimension',
    pattern: new RegExp(`(?:${UNOBSERVABLE_COMPARISON_DIMENSIONS.join('|')})[^,;)\\n]{0,24}(?:\\?\\?|\\|\\|)\\s*0\\b`),
    why: 'These three are null on every report by construction. Defaulting one to 0 averages an absence in as measured parity.',
  },
  {
    name: 'no zero-default on a nullable company radar axis',
    pattern: new RegExp(`(?:${NULLABLE_COMPANY_RADAR_AXES.join('|')})[^,;)\\n]{0,24}(?:\\?\\?|\\|\\|)\\s*0\\b`),
    why: 'A null axis means the company was never observed on it. Zeroing it hands the competitor its own absolute score back as a measured gap.',
  },
  {
    name: 'no zero-default on a delta member',
    pattern: /deltas?(?:_vs_company)?\.[A-Za-z_]+\s*(?:\?\?|\|\|)\s*0\b/,
    why: 'A delta exists only where BOTH sides were observed; `?? 0` turns "not comparable" into "exactly at par".',
  },
  {
    name: 'no Number() coercion of a delta member before the guard',
    pattern: /Number\(\s*deltas?(?:_vs_company)?\.[A-Za-z_]+\s*(?:\?\?|\|\|)\s*0/,
    why: '`Number(null)` is 0 and 0 is finite, so a following `Number.isFinite` filter cannot undo it. Guard the RAW value.',
  },
  {
    name: 'no whole-metrics zero baseline',
    pattern: /EMPTY_[A-Z_]*METRICS/,
    why: 'A zeroed seven-dimension baseline is a measurement claim that the company has no content, authority or coverage. WP-12 removed it.',
  },
];

describe('WP-13 — competitive-evidence null contract tripwire', () => {
  const resolved = COMPARISON_PRODUCER_FILES.map((relative) => ({
    relative,
    absolute: join(REPO_ROOT, relative),
  })).filter((entry) => existsSync(entry.absolute));

  it('resolves every listed producer — a tripwire that matches nothing is worse than none', () => {
    expect(resolved.map((entry) => entry.relative)).toEqual(COMPARISON_PRODUCER_FILES);
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('the scan actually reads source — the stripped bodies are non-empty', () => {
    for (const entry of resolved) {
      const stripped = stripComments(readFileSync(entry.absolute, 'utf8'));
      expect(stripped.trim().length).toBeGreaterThan(200);
    }
  });

  it('the comment stripper removes the prose that documents the forbidden expressions', () => {
    const raw = readFileSync(
      join(REPO_ROOT, 'backend/services/snapshotReport/visualIntelligenceHelpers.ts'),
      'utf8',
    );
    // The file explains the defect by quoting it. Raw text matches; stripped text must not.
    expect(/Number\(deltas\.<dim> \?\? 0\)/.test(raw)).toBe(true);
    expect(/Number\(deltas\.<dim> \?\? 0\)/.test(stripComments(raw))).toBe(false);
  });

  for (const rule of RULES) {
    it(`${rule.name}`, () => {
      const violations: string[] = [];
      for (const entry of resolved) {
        const stripped = stripComments(readFileSync(entry.absolute, 'utf8'));
        stripped.split('\n').forEach((line, index) => {
          const match = rule.pattern.exec(line);
          if (match) violations.push(`${entry.relative}:${index + 1}  ${match[0].trim()}  — ${rule.why}`);
        });
      }
      expect(violations).toEqual([]);
    });
  }

  it('the company radar baseline is compared raw, not through the flattened wire shape', () => {
    const helpers = readFileSync(
      join(REPO_ROOT, 'backend/services/snapshotReport/competitorSummaryHelpers.ts'),
      'utf8',
    );
    // `buildCompetitorIntelligenceSummary` must take the `number | null` baseline, so an
    // unobserved axis cannot be read back as a measured 0 from the published radar.
    expect(/userAxisValues:\s*CompetitorRadarAxisValues/.test(helpers)).toBe(true);
    // The availability guard is on the raw value, before any coercion.
    expect(/typeof value === 'number' && Number\.isFinite\(value\)/.test(helpers)).toBe(true);

    const service = readFileSync(join(REPO_ROOT, 'backend/services/snapshotReportService.ts'), 'utf8');
    expect(/userAxisValues:\s*deriveUserRadarAxisValues\(/.test(service)).toBe(true);
  });

  it('every rule actually bites — each one matches the defect it was written for', () => {
    // A tripwire whose regexes match nothing is a no-op that reads like protection. These are
    // the real expressions removed by WP-12, WP-15, WP-17/18 and WP-13.
    const knownDefects: Array<[string, string]> = [
      ['no zero-default on an unobservable comparison dimension', 'Number(delta.geo_presence ?? 0),'],
      ['no zero-default on a unobservable comparison dimension (||)', 'const pf = metrics.publishing_frequency || 0;'],
      ['no zero-default on a nullable company radar axis', 'Math.round(radar.backlinks_score ?? 0),'],
      ['no zero-default on a nullable company radar axis (answers)', 'Math.round(geo.answer_coverage_score ?? 0),'],
      ['no zero-default on a delta member', 'const d = deltas.content_depth ?? 0;'],
      ['no Number() coercion of a delta member before the guard', 'Number(deltas.authority_score ?? 0)'],
      ['no whole-metrics zero baseline', 'comparison.company ?? EMPTY_COMPARISON_METRICS'],
    ];
    for (const [label, sample] of knownDefects) {
      const caught = RULES.some((rule) => rule.pattern.test(sample));
      expect([label, caught]).toEqual([label, true]);
    }
  });

  it('the decision-prioritisation defaults are NOT prohibited by these rules', () => {
    // Explicitly pinned: these two sites are outside the competitive-evidence contract and the
    // tripwire must keep passing with them present. If a future rule fires here, the rule is
    // wrong, not the code.
    const actionHelpers = readFileSync(
      join(REPO_ROOT, 'backend/services/snapshotReport/actionHelpers.ts'),
      'utf8',
    );
    const stripped = stripComments(actionHelpers);
    expect(/decision\.confidence_score \?\? 0/.test(stripped)).toBe(true);
    expect(/decision\.effort_score \?\? 0/.test(stripped)).toBe(true);
    for (const rule of RULES) {
      expect(rule.pattern.test(stripped)).toBe(false);
    }
  });
});
