/**
 * CREATOR-126 — BUILD/MIGRATION-TIME bootstrap. Regenerates the persisted canonical
 * SYSTEM CreatorTemplate snapshot by running the CreatorTemplateMaterializer ONCE and
 * writing the fully-materialized templates to a static JSON file. This is the ONLY
 * place the materializer (and, through it, marketingSample) runs for the gallery —
 * the app runtime then loads the JSON directly, with no runtime materialization.
 *
 * Re-run this whenever the curated library or its design intelligence changes:
 *   npx tsx scripts/bootstrap-system-templates.ts
 */
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'x',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
for (const [k, v] of Object.entries(LOCAL_ENV)) if (!process.env[k]) process.env[k] = v;

void (async () => {
  const path = await import('path');
  const { mkdirSync, writeFileSync } = await import('fs');
  const { materializeAllCuratedTemplates } = await import('../lib/creator-outcomes/creatorTemplateMaterializer');

  const templates = materializeAllCuratedTemplates();
  const dir = path.join(process.cwd(), 'content', 'creator-templates');
  mkdirSync(dir, { recursive: true });

  // (1) COMPLETE canonical store — every CREATOR-124 field. The source of truth for
  //     generation + future consumers (NOT loaded by the gallery client bundle).
  const full = path.join(dir, 'system-templates.json');
  writeFileSync(full, JSON.stringify(templates));

  // (2) LEAN gallery projection — a valid CreatorTemplate with only the fields the
  //     Sample Gallery displays; the heavy GENERATION-only optional fields (styles,
  //     generationDNA, semanticStructure, composition, locked/editable regions) are
  //     dropped so the client gallery stays lean. `adaptation` is kept (details modal).
  const lean = templates.map((t) => {
    const { infographicStyle, imageStyle, carouselStyle, generationDNA, semanticStructure, composition, lockedRegions, editableRegions, ...rest } = t;
    void infographicStyle; void imageStyle; void carouselStyle; void generationDNA; void semanticStructure; void composition; void lockedRegions; void editableRegions;
    return rest;
  });
  const galleryFile = path.join(dir, 'system-templates.gallery.json');
  writeFileSync(galleryFile, JSON.stringify(lean));

  const byFam = templates.reduce<Record<string, number>>((a, t) => { a[t.assetFamily] = (a[t.assetFamily] ?? 0) + 1; return a; }, {});
  console.log(`wrote ${templates.length} persisted SYSTEM CreatorTemplates`);
  console.log(`  complete store: ${full} (${JSON.stringify(byFam)})`);
  console.log(`  gallery projection: ${galleryFile}`);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
