/**
 * BARREL — content split into two modules (verbatim move, importers keep this path):
 *   competitorEngineServiceEngineRankingScore — Competitor engine — scoring + rationale (fn-level cycle with Final: deferred calls, runtime-safe)
 *   competitorEngineServiceEngineRankingFinal — Competitor engine — final selection + entrypoints
 */
export * from './competitorEngineServiceEngineRankingScore';
export * from './competitorEngineServiceEngineRankingFinal';
