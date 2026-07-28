/**
 * CI-C301 — Technology Intelligence (deterministic contributor).
 * Stack / cloud / languages / databases / DevOps / security / AI / integrations / migrations →
 * technology facet + a `maturity` score contribution (modern-stack + AI + migration proxy).
 * Abstains without technology evidence.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'technology';

export function runTechnology(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const t = ctx.technology;
  if (!t) return emptyOutput(ENGINE);
  const src = t.source ?? 'tech_intelligence'; const at = t.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];
  const add = (label: string, arr?: string[], kind: 'structured' | 'observed' = 'structured') => { if (arr?.length) evidence.push(mkEvidence(ENGINE, { label, value: arr.join('; '), source: src, observedAt: at, kind })); };
  add('tech:stack', t.stack); add('tech:cloud', t.cloud); add('tech:languages', t.languages); add('tech:databases', t.databases);
  add('tech:devops', t.devops); add('tech:security', t.security); add('tech:ai', t.ai); add('tech:integrations', t.integrations); add('tech:migrations', t.migrations, 'observed');
  if (!evidence.length) return emptyOutput(ENGINE);

  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence, edges: [], reasoning: [] } as CompanyEngineOutput;
  out.facets.technology = facet({ stack: t.stack, adoption: t.ai, migrations: t.migrations }, evidence);
  // Maturity proxy: breadth + AI adoption + active migration (bounded).
  const breadth = clamp01(((t.stack?.length ?? 0) + (t.cloud?.length ?? 0) + (t.devops?.length ?? 0)) / 12);
  const maturity = clamp01(0.5 * breadth + (t.ai?.length ? 0.3 : 0) + (t.migrations?.length ? 0.2 : 0));
  out.contributions.push({ dimension: 'maturity', contributor: ENGINE, method: 'deterministic', value: maturity, confidence: clamp01(0.5 + 0.1 * Math.min(evidence.length, 4)), evidence, asOf: at });
  out.reasoning.push(reasoningTrace({ claim: 'technology_maturity', conclusion: maturity, because: evidence, confidence: 0.6, method: 'deterministic', assumptions: ['breadth + AI + migration proxy'], unknowns: t.migrations?.length ? [] : ['no migration signal'] }));
  return out;
}
