#!/usr/bin/env node
/**
 * DG-008 mutation battery.
 *
 * Modelled on scripts/d1-mutations.js. Each entry reintroduces one specific way
 * the AI-visibility overstatement could return to a customer-facing surface, or
 * swaps the provenance gate for a weaker one that looks equivalent. A mutation is
 * KILLED when the DG-008 suite fails with it applied; a SURVIVOR means the suite
 * does not actually constrain that behaviour, and the suite is wrong.
 *
 * Scope note. Every entry is behavioural at a surface this suite renders. The
 * upstream D1 caps (`dimAiSurfacePresence` promoting the crawl proxy back to
 * `measured`) are NOT listed here: they belong to scripts/d1-mutations.js (M7),
 * and DG-008's renderer is deliberately independent of them — N4 asserts that
 * independence at the renderer instead, which is the property this fix owns.
 *
 * Every mutation is applied to a copy, run, and reverted — the tree is restored
 * even if a run throws.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SUITE = 'backend/tests/unit/dg008AiSurfacePresentationIntegrity.test.ts';
const RENDERER = 'backend/services/intelligence/exportRendererAssembly.ts';

/** The AI-block gate, verbatim — the anchor several mutations rewrite. */
const AI_BLOCK_GATE =
  "  const aiObserved = surfaces.ai_visibility_state.state !== 'unmeasured';\n" +
  '  const surfaceValue = scoreNumber(section.surface_score);';

/** The snapshot gate, verbatim. */
const SNAPSHOT_GATE =
  "  const aiObserved = surfaces.ai_visibility_state.state !== 'unmeasured';\n" +
  '  const aiVisibility = aiObserved && isMeasuredScore(aiScore)';

const CHIP_DETAIL_GUARDED =
  '            <span class="ds-aistate-chip-detail">${escape(\n' +
  '              aiObserved\n' +
  '                ? `AI surface ${surfaceValue}/100`\n' +
  "                : 'No answer engine returned a grounded result for this run',\n" +
  '            )}</span>';

const CHIP_DETAIL_UNGUARDED =
  '            <span class="ds-aistate-chip-detail">${escape(`AI surface ${surfaceValue}/100`)}</span>';

const MUTATIONS = [
  {
    id: 'N1',
    name: 'restore the unconditional "AI surface N/100" chip detail',
    file: RENDERER,
    from: CHIP_DETAIL_GUARDED,
    to: CHIP_DETAIL_UNGUARDED,
  },
  {
    id: 'N2',
    name: 'plant the spectrum marker from the structural score again',
    file: RENDERER,
    from: '        ${renderAISurfaceSpectrum(aiObserved ? section.surface_score.value : null, section.surface_score.state)}',
    to: '        ${renderAISurfaceSpectrum(section.surface_score.value, section.surface_score.state)}',
  },
  {
    id: 'N3',
    name: 'gate the AI block on confidence instead of provenance',
    file: RENDERER,
    from: AI_BLOCK_GATE,
    to: AI_BLOCK_GATE.replace(
      "surfaces.ai_visibility_state.state !== 'unmeasured'",
      'isMeasuredScore(section.surface_score)',
    ),
  },
  {
    id: 'N4',
    name: "trust the AI score's self-description instead of the observed-cell fact",
    file: RENDERER,
    from: AI_BLOCK_GATE,
    to: AI_BLOCK_GATE.replace(
      "surfaces.ai_visibility_state.state !== 'unmeasured'",
      "section.surface_score.state === 'measured'",
    ),
  },
  {
    id: 'N5',
    name: 'invert the AI-block gate so a grounded observation is the one withheld',
    file: RENDERER,
    from: AI_BLOCK_GATE,
    to: AI_BLOCK_GATE.replace(
      "surfaces.ai_visibility_state.state !== 'unmeasured'",
      "surfaces.ai_visibility_state.state === 'unmeasured'",
    ),
  },
  {
    id: 'N6',
    name: 'drop the honest reason, leaving a bare chip the reader cannot interpret',
    file: RENDERER,
    from: "                : 'No answer engine returned a grounded result for this run',",
    to: "                : '',",
  },
  {
    id: 'N7',
    name: 'band the snapshot AI signal on confidence alone (the pre-fix line)',
    file: RENDERER,
    from: '  const aiVisibility = aiObserved && isMeasuredScore(aiScore)',
    to: '  const aiVisibility = isMeasuredScore(aiScore)',
  },
  {
    id: 'N8',
    name: 'gate the snapshot signal on the score state instead of the D1 surface',
    file: RENDERER,
    from: SNAPSHOT_GATE,
    to: SNAPSHOT_GATE.replace(
      "surfaces.ai_visibility_state.state !== 'unmeasured'",
      "aiScore.state === 'inferred' || aiScore.state === 'measured'",
    ),
  },
  {
    id: 'N9',
    name: 'let a structural score drive the D1 surface (upstream gate removed)',
    file: 'backend/services/intelligence/dossier/intelligenceSurfacesCompetitive.ts',
    from: '  const aiValue = observedAiCells > 0 && isMeasuredScore(aiScore) ? (aiScore.value as number) : null;',
    to: '  const aiValue = isMeasuredScore(aiScore) ? (aiScore.value as number) : null;',
  },
  {
    id: 'N10',
    name: 'let the spectrum plot a marker for any non-null value',
    file: 'backend/services/intelligence/dossier/visualPrimitives.ts',
    from:
      'export function renderAISurfaceSpectrum(value: number | null, state?: string): string {\n' +
      '  const measured =\n' +
      "    typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable';",
    to:
      'export function renderAISurfaceSpectrum(value: number | null, state?: string): string {\n' +
      "  const measured = state !== 'insufficient_signal' && state !== 'unavailable';",
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

console.log('\n============== DG-008 MUTATION RESULTS ==============');
for (const r of results) {
  console.log(`${r.id.padEnd(4)} ${r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'N/A     '} ${r.name}`);
  if (!r.verdict.startsWith('KILLED')) console.log(`      -> ${r.verdict}`);
}
const survivors = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - survivors.length}/${results.length} killed`);
process.exit(survivors.length === 0 ? 0 : 1);
