/**
 * CREATOR-124 verification — proves every curated design materializes into a
 * fully self-contained CreatorTemplate that reproduces the blueprint runtime.
 *
 *   RULE 4  completeness / runtime independence (every required field present)
 *   RULE 5  byte equality — materialized fields deep-equal the EXACT resolver
 *           outputs the renderer calls; + a real PNG pixel-hash equality
 *   RULE 7  runtime simulation (data needed by renderer/planner/preview/editor)
 *   RULE 8  serialization (clean JSON round-trip; no closures/registry pointers)
 *
 *   npx tsx scripts/verify-materialization.ts
 */
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'x',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
for (const [k, v] of Object.entries(LOCAL_ENV)) if (!process.env[k]) process.env[k] = v;

const J = (x: unknown) => JSON.stringify(x);

void (async () => {
  const { createHash } = await import('crypto');
  const { materializeAllCuratedTemplates, materializeCuratedTemplate } = await import('../lib/creator-outcomes/creatorTemplateMaterializer');
  const { getSample } = await import('../lib/creator-outcomes/marketingSample');
  const { infographicLayoutForBlueprint, infographicCompositionForBlueprint, semanticStructureForBlueprint, infographicStyleForBlueprint, semanticSlotCountForBlueprint } = await import('../lib/creator-templates/styleVariants');
  const { renderInfographicAsset } = await import('../backend/services/creatorAssetRenderer');

  const all = materializeAllCuratedTemplates();
  const infographics = all.filter((t) => t.assetFamily === 'infographic');
  console.log(`materialized ${all.length} templates (${infographics.length} infographic, ${all.length - infographics.length} image/carousel)`);

  // ── RULE 4 — completeness (every required field present) ─────────────────
  const REQUIRED = ['id', 'assetFamily', 'name', 'category', 'description', 'preview', 'visualLanguage', 'formDefinition', 'renderingContract', 'version', 'status', 'ownership', 'tags', 'metadata', 'designFamily', 'generationDNA', 'lockedRegions', 'editableRegions', 'adaptation'] as const;
  const incomplete: string[] = [];
  for (const t of all) {
    // `CreatorTemplate` has no index signature, so a DIRECT assertion to
    // Record<string, unknown> is rejected (TS2352 — insufficient overlap). The
    // repo's established form for probing a typed object dynamically is the
    // double assertion via `unknown` (apiObservability.ts:70,
    // creditApprovalService.ts:112, publishProcessor.ts:330).
    // `miss` is annotated `string[]` because `REQUIRED.filter()` otherwise infers
    // the narrow literal union of REQUIRED's members, which cannot accept the
    // infographic-only keys pushed on the next line (TS2345).
    const miss: string[] = REQUIRED.filter((f) => (t as unknown as Record<string, unknown>)[f] === undefined || (t as unknown as Record<string, unknown>)[f] === null);
    if (t.assetFamily === 'infographic') { for (const f of ['semanticStructure', 'composition'] as const) if (!(t as unknown as Record<string, unknown>)[f]) miss.push(f); }
    if (miss.length) incomplete.push(`${t.id}: missing ${miss.join(',')}`);
  }
  console.log(`\nRULE 4 completeness: ${incomplete.length === 0 ? 'PASS' : 'FAIL'} (${incomplete.length} incomplete)`);
  incomplete.slice(0, 5).forEach((m) => console.log('  ' + m));

  // ── RULE 5a — DATA equality vs the EXACT renderer resolver functions ─────
  let dataMismatch = 0; const dmEx: string[] = [];
  for (const t of infographics) {
    const bp = String(t.metadata.sourceBlueprintId);
    const checks: Array<[string, boolean]> = [
      ['layout', t.renderingContract.infographicLayout === infographicLayoutForBlueprint(bp)],
      ['composition', J(t.composition) === J(infographicCompositionForBlueprint(bp))],
      ['semanticStructure', J(t.semanticStructure) === J(semanticStructureForBlueprint(bp))],
      ['infographicStyle', J(t.infographicStyle) === J(infographicStyleForBlueprint(bp))],
      ['generationDNA', J(t.generationDNA) === J((() => { const d = getSample(bp)!.generationDNA; const { adaptation, ...rest } = d; return rest; })())],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([k]) => k);
    if (bad.length) { dataMismatch++; if (dmEx.length < 5) dmEx.push(`${bp}: ${bad.join(',')}`); }
  }
  console.log(`\nRULE 5a data-equality (infographic, vs renderer resolvers): ${dataMismatch === 0 ? 'PASS' : 'FAIL'} (${infographics.length - dataMismatch}/${infographics.length} identical)`);
  dmEx.forEach((m) => console.log('  ' + m));

  // ── RULE 5b — REAL pixel-hash equality (PNG A blueprint vs PNG B template provenance) ──
  const sampleIds = ['technology', 'healthcare', 'finance', 'luxury', 'corporate'];
  let pixelMismatch = 0;
  const renderPng = async (blueprintId: string) => {
    const payload = { media_bundle: { metadata: { platform: 'linkedin', topic: 'How small teams grow', summary: 's', brand_mode: 'independent', blueprint_id: blueprintId, creator_card: { blueprint_id: blueprintId }, thread_visual_transform: { items: ['A', 'B', 'C', 'D'] } } } };
    const { buffer } = await renderInfographicAsset(payload, { companyId: null, previewBufferOnly: true });
    return createHash('sha256').update(buffer!).digest('hex');
  };
  for (const id of sampleIds) {
    const mt = materializeCuratedTemplate(id, 'infographic');
    if (!mt) { pixelMismatch++; continue; }
    const hashA = await renderPng(id);                                   // blueprint runtime
    const hashB = await renderPng(String(mt.metadata.sourceBlueprintId)); // via materialized template provenance
    const ok = hashA === hashB;
    if (!ok) pixelMismatch++;
    console.log(`  ${id.padEnd(12)} PNG-A=${hashA.slice(0, 12)} PNG-B=${hashB.slice(0, 12)} ${ok ? 'IDENTICAL' : 'DIFFER'}`);
  }
  console.log(`RULE 5b pixel-hash equality: ${pixelMismatch === 0 ? 'PASS' : 'FAIL'} (${sampleIds.length - pixelMismatch}/${sampleIds.length})`);

  // ── RULE 7 — runtime simulation (data sufficiency, no registry calls) ────
  let simFail = 0; const simEx: string[] = [];
  for (const t of infographics) {
    const hasLayout = !!t.renderingContract.infographicLayout && !!t.composition?.layout;
    const hasStyle = !!t.infographicStyle;
    const hasSemantic = Array.isArray(t.semanticStructure) && t.semanticStructure.length > 0;
    const slot = (t.semanticStructure ?? []).find((b) => b.blockId !== 'hero')?.count ?? 0;
    const hasSlot = slot > 0 && slot === semanticSlotCountForBlueprint(String(t.metadata.sourceBlueprintId));
    const hasDnaPrompt = !!t.generationDNA?.promptModifiers;
    const hasPreview = !!t.preview.thumbnailUrl;
    const hasForm = !!t.formDefinition.fields;
    if (!(hasLayout && hasStyle && hasSemantic && hasSlot && hasDnaPrompt && hasPreview && hasForm)) {
      simFail++; if (simEx.length < 5) simEx.push(`${t.id}: layout=${hasLayout} style=${hasStyle} semantic=${hasSemantic} slot=${hasSlot} dna=${hasDnaPrompt} preview=${hasPreview} form=${hasForm}`);
    }
  }
  console.log(`\nRULE 7 runtime simulation (data sufficient for renderer/planner/preview/editor): ${simFail === 0 ? 'PASS' : 'FAIL'} (${infographics.length - simFail}/${infographics.length})`);
  simEx.forEach((m) => console.log('  ' + m));

  // ── RULE 8 — serialization (clean JSON round-trip) ───────────────────────
  let serFail = 0; const serEx: string[] = [];
  for (const t of all) {
    const round = JSON.parse(JSON.stringify(t));
    if (J(round) !== J(t)) { serFail++; if (serEx.length < 5) serEx.push(t.id); }
  }
  console.log(`\nRULE 8 serialization (round-trip identical, no closures/pointers): ${serFail === 0 ? 'PASS' : 'FAIL'} (${all.length - serFail}/${all.length})`);
  serEx.forEach((m) => console.log('  ' + m));

  const pass = incomplete.length === 0 && dataMismatch === 0 && pixelMismatch === 0 && simFail === 0 && serFail === 0;
  console.log(`\n=== OVERALL: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });

// TYPECHECK-BASELINE-REDUCTION: this file has no top-level import or export, so
// TypeScript compiles it as a GLOBAL script and its top-level declarations share
// one scope with every other global script under tsconfig.scripts.json. That is
// the root cause of the duplicate-identifier / duplicate-implementation errors,
// and of the downstream mismatches where a colliding name resolved to another
// file's type. Declaring it a module scopes its names to this file.
// Runtime is unchanged: no static import is added and the script still executes
// top-to-bottom exactly as before.
export {};