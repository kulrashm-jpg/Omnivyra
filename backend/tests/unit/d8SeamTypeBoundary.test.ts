/**
 * D8 — the competitor-metrics seam must not depend on the modules that consume it.
 *
 * WHY THIS EXISTS. The seam (competitorMetricsEvidence) imported ComparisonMetrics
 * from reportCompetitorIntelligenceServiceModel and DomainCrawlSignals from
 * reportCompetitorIntelligenceServiceHelpers, while both of those imported
 * CompetitorCrawlOutcome from the seam. Those mutual type-only imports put the seam
 * inside eight dependency cycles that the native architecture gate counted as new
 * debt from the union. The fix moved the three shared types into a leaf module
 * (competitorMetricsTypes) so the graph points one way:
 *
 *   competitorMetricsEvidence ──▶ competitorMetricsTypes ◀── Model / Helpers
 *
 * The native gate (`npm run check:architecture-boundaries`) is the authoritative
 * cycle detector, but its baselines are not tracked in this repository, so it
 * cannot run in ordinary CI. This guard pins the specific edges whose return would
 * recreate those cycles, and runs anywhere.
 *
 * Comments are stripped before reading imports, so an explanation that NAMES a
 * module can never satisfy or fail this guard.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SEAM = 'backend/services/competitor/competitorMetricsEvidence.ts';
const LEAF = 'backend/services/competitor/competitorMetricsTypes.ts';
const CONSUMERS = [
  'backend/services/reportCompetitorIntelligenceServiceModel.ts',
  'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
];

const executable = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every module specifier this file imports or re-exports from. */
const specifiers = (rel: string): string[] =>
  [...executable(rel).matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('D8 — the seam depends on shared types, never on its consumers', () => {
  it('the seam imports nothing from the competitor-intelligence Model or Helpers', () => {
    const offending = specifiers(SEAM).filter((s) => /reportCompetitorIntelligenceService(Model|Helpers)/.test(s));
    expect(offending).toEqual([]);
  });

  it('the seam takes its shared types from the leaf module', () => {
    expect(specifiers(SEAM)).toContain('./competitorMetricsTypes');
  });

  it('neither consumer imports the seam — they share the leaf instead', () => {
    for (const consumer of CONSUMERS) {
      expect({ consumer, seamImports: specifiers(consumer).filter((s) => /competitor\/competitorMetricsEvidence/.test(s)) })
        .toEqual({ consumer, seamImports: [] });
      expect(specifiers(consumer)).toContain('./competitor/competitorMetricsTypes');
    }
  });

  it('the leaf imports only D2’s canonical reachability type, so it cannot join a cycle', () => {
    expect(specifiers(LEAF)).toEqual(['../crawl/reachabilityOutcome']);
    // A type-only import: the leaf carries no runtime dependency at all.
    expect(executable(LEAF)).toMatch(/import type \{ ReachabilityOutcome \} from '\.\.\/crawl\/reachabilityOutcome'/);
  });

  it('the leaf holds types only — no runtime code, so it cannot become a logic dump', () => {
    const code = executable(LEAF);
    expect(code).not.toMatch(/\bfunction\b|=>|\bclass\b|\bnew\b/);
    expect(code).not.toMatch(/^\s*(export\s+)?(const|let|var)\b/m);
    const exported = [...code.matchAll(/export type (\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual(['ComparisonMetrics', 'CompetitorCrawlOutcome', 'DomainCrawlSignals']);
  });

  it('each shared type is DEFINED once — the old homes only re-export it', () => {
    // Moving a type must not leave a second, drifting definition behind.
    expect(executable(SEAM)).not.toMatch(/export type CompetitorCrawlOutcome\s*=/);
    expect(executable(CONSUMERS[0])).not.toMatch(/export type ComparisonMetrics\s*=/);
    expect(executable(CONSUMERS[1])).not.toMatch(/export type DomainCrawlSignals\s*=/);
    expect(executable(SEAM)).toMatch(/export type \{ CompetitorCrawlOutcome \}/);
    expect(executable(CONSUMERS[0])).toMatch(/export type \{ ComparisonMetrics \}/);
    expect(executable(CONSUMERS[1])).toMatch(/export type \{ DomainCrawlSignals \}/);
  });
});
