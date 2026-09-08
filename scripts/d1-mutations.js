#!/usr/bin/env node
/**
 * D1 mutation battery.
 *
 * Each entry reintroduces one specific way the fabrication could come back. A
 * mutation is KILLED when the D1 suite fails with it applied. A SURVIVOR means
 * the suite does not actually constrain that behaviour, and the suite is wrong.
 *
 * Every mutation is applied to a copy, run, and reverted — the tree is restored
 * even if a run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/d1AiVisibilityMeasurementIntegrity.test.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore regex-only `measured` (shared adapter base)',
    file: 'backend/services/intelligence/adapters/llmAdapterBase.ts',
    from: '    const measured = resolution.state === \'measured\';',
    to: '    const measured = true;',
  },
  {
    id: 'M2',
    name: 'count brand text present in the PROMPT as evidence',
    file: 'backend/services/intelligence/citationExtractor.ts',
    from: '  const answer = params.answer ?? \'\';',
    to: '  const answer = `${params.answer ?? \'\'} ${params.query}`;',
  },
  {
    id: 'M3',
    name: 'mark any LLM response as PUBLIC_OBSERVED',
    file: 'backend/services/evidenceProvenance.ts',
    from: '  llm_probe: \'INFERRED\',',
    to: '  llm_probe: \'PUBLIC_OBSERVED\',',
  },
  {
    id: 'M4',
    name: 'mark an unconfigured provider as measured',
    file: 'backend/services/intelligence/aiVisibilityGrounding.ts',
    from: "      : { state: 'unavailable', outcome: 'no_provider', reason: 'No observation was returned.' };",
    to: "      : { state: 'measured', outcome: 'no_provider', reason: 'No observation was returned.' };",
  },
  {
    id: 'M5',
    name: 'convert provider failure into measured',
    file: 'backend/services/intelligence/aiVisibilityGrounding.ts',
    from: "      ? { state: 'unavailable', outcome: 'provider_failed', reason: failureReason }",
    to: "      ? { state: 'measured', outcome: 'provider_failed', reason: failureReason }",
  },
  {
    id: 'M6',
    name: 'remove the citation/source evidence requirement',
    file: 'backend/services/intelligence/aiVisibilityGrounding.ts',
    from: '  const sourced = observations.filter((o) => o.grounded_sources.length > 0);',
    to: '  const sourced = observations;',
  },
  {
    id: 'M7',
    name: 'use the structural crawl proxy as external AI visibility',
    file: 'backend/services/canonicalReport/canonicalReportBuilderInputs.ts',
    from: "  const state: ScoreState = typeof value === 'number' ? 'inferred' : 'insufficient_signal';",
    to: "  const state: ScoreState = typeof value === 'number' ? 'measured' : 'insufficient_signal';",
  },
  {
    id: 'M7b',
    name: 'let a structural score drive the AI-visibility narrative',
    file: 'backend/services/intelligence/dossier/intelligenceSurfacesCompetitive.ts',
    from: '  const aiValue = observedAiCells > 0 && isMeasuredScore(aiScore) ? (aiScore.value as number) : null;',
    to: '  const aiValue = isMeasuredScore(aiScore) ? (aiScore.value as number) : null;',
  },
  {
    id: 'M8',
    name: 'publish a numeric rate from an unmeasured probe',
    file: 'backend/services/intelligence/adapters/llmAdapterBase.ts',
    from: '      citation_rate: measured ? Number((appeared.length / mentions.length).toFixed(3)) : null,',
    to: '      citation_rate: Number((appeared.length / mentions.length).toFixed(3)),',
  },
  {
    id: 'M9',
    name: 'bypass provenance construction (always claim answer_engine)',
    file: 'backend/services/intelligence/adapters/llmAdapterBase.ts',
    from: "    const sourceKind: EvidenceSourceKind = measured ? 'answer_engine' : 'llm_probe';",
    to: "    const sourceKind: EvidenceSourceKind = 'answer_engine';",
  },
  {
    id: 'M10',
    name: 'declare the ungrounded chat adapter retrieval-grounded',
    file: 'backend/services/intelligence/adapters/openaiAdapter.ts',
    from: '  public readonly retrieval_grounded = false;',
    to: '  public readonly retrieval_grounded = true;',
  },
  {
    id: 'M11',
    name: 'corroborate on substring instead of host equality',
    file: 'backend/services/intelligence/aiVisibilityGrounding.ts',
    from: '    return host === target || host.endsWith(`.${target}`);',
    to: '    return host.includes(target);',
  },
  {
    id: 'M12',
    name: 'flatten grounded citations back into the answer prose',
    file: 'backend/services/intelligence/adapters/perplexityAdapter.ts',
    from: '  protected extractGroundingSources(response: unknown): string[] {',
    to: '  protected extractGroundingSourcesDISABLED(response: unknown): string[] {',
  },
];

const results = [];
for (const m of MUTATIONS) {
  const original = fs.readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    results.push({ ...m, verdict: 'NOT APPLICABLE — anchor not found' });
    continue;
  }
  fs.writeFileSync(m.file, original.replace(m.from, m.to), 'utf8');
  let killed = false;
  let detail = '';
  try {
    execSync(`npx jest ${SUITE} --silent`, { stdio: 'pipe', encoding: 'utf8' });
    detail = 'suite still passed';
  } catch (err) {
    killed = true;
    const out = String(err.stdout || '') + String(err.stderr || '');
    const m2 = out.match(/Tests:\s+(\d+) failed/);
    detail = m2 ? `${m2[1]} test(s) failed` : 'suite failed';
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  results.push({ ...m, verdict: killed ? `KILLED (${detail})` : `SURVIVED (${detail})` });
}

console.log('\n================ D1 MUTATION RESULTS ================');
for (const r of results) {
  console.log(`${r.id.padEnd(4)} ${r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     '} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
