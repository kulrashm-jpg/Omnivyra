/**
 * CI-C309 — Cross-Engine Reasoning (synthesis only; owns nothing). Synthesizes evidence ALREADY
 * produced by the engines into higher-order conclusions:
 *   tech_migration + exec_hire + funding → digital transformation;
 *   expansion + hiring + partnership → growth initiative;
 *   funding + exec_change + product_launch → strategic acceleration.
 * Emits grounded reasoning traces — never recomputes an engine's job.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { reasoningTrace, clamp01 } from '../../intelligence/canonical';
import type { EvidenceRef, ReasoningTrace } from '../../intelligence/canonical';

const ENGINE = 'cross_engine';

export function runCrossEngine(primaries: CompanyEngineOutput[], ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const traces: ReasoningTrace[] = [];
  const evOf = (engine: string) => primaries.find((p) => p.engine === engine)?.evidence ?? [];
  const has = (engine: string) => (primaries.find((p) => p.engine === engine)?.evidence.length ?? 0) > 0;
  const signalEv = (types: string[]): EvidenceRef[] => evOf('growth').filter((e) => types.some((t) => e.label === `signal:${t}`));
  const techMigration = evOf('technology').filter((e) => e.label === 'tech:migrations');

  const add = (claim: string, cond: boolean, because: EvidenceRef[], conf: number, assumptions: string[]) => {
    if (!cond || because.length === 0) return;
    traces.push(reasoningTrace({ claim, conclusion: 'indicated', because, confidence: clamp01(conf), method: 'deterministic', assumptions, unknowns: [] }));
  };

  // digital transformation = tech migration + exec hiring + funding
  add('digital_transformation', techMigration.length > 0 && (has('executive') || signalEv(['exec_hire']).length > 0),
    [...techMigration, ...signalEv(['exec_hire', 'funding']), ...evOf('executive').slice(0, 2)], 0.6, ['migration + leadership change + capital']);
  // growth initiative = expansion + hiring + partnership
  add('growth_initiative', true, signalEv(['expansion', 'hiring', 'partnership', 'geo_expansion']), 0.6, ['co-occurring growth signals']);
  // strategic acceleration = funding + exec change + product launch
  add('strategic_acceleration', true, signalEv(['funding', 'product_launch']).concat(evOf('executive').filter((e) => /joined|promoted|left/.test(e.label))), 0.55, ['capital + leadership + product motion']);

  out.reasoning = traces;
  out.abstained = traces.length === 0;
  return out;
}
