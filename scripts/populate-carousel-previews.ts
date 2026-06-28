/**
 * CREATOR-106 — generate carousel-SHAPED previews so carousel samples stop reusing the
 * flat image previews. For every carousel-supporting blueprint it renders a multi-slide
 * deck (renderCreatorCarouselReviewPreview) and writes public/creator-showcases/<id>/
 * carousel.png. Local-only, no AI, no Storage, no credits (same as the image populate).
 *
 *   npx tsx scripts/populate-carousel-previews.ts
 */

const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'local-dev-service-role-key',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-dev-anon-key',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
for (const [k, v] of Object.entries(LOCAL_ENV)) if (!process.env[k]) process.env[k] = v;

const DEMO = { company: 'Acme Technologies', product: 'CRM Platform', audience: 'SMBs', goal: 'Generate Leads' };

void (async () => {
  const path = await import('path');
  const { mkdirSync, writeFileSync } = await import('fs');
  const { listSamples } = await import('../lib/creator-outcomes/marketingSample');
  const { renderCreatorCarouselReviewPreview } = await import('../backend/services/creatorAssetRenderer');

  const DIR = path.join(process.cwd(), 'public', 'creator-showcases');
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;
  const samples = listSamples('carousel').slice(0, limit ?? undefined);
  console.error(`[run] ${samples.length} carousel-supporting samples${limit ? ` (LIMIT=${limit})` : ''}`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];

  for (const s of samples) {
    try {
      const { buffer } = await renderCreatorCarouselReviewPreview({
        assetType: 'image',
        platform: 'linkedin',
        title: `${DEMO.company} ${DEMO.product}`,
        body: `${DEMO.product} for ${DEMO.audience} — ${DEMO.goal}`,
        overlayText: { headline: DEMO.goal, subheadline: `${DEMO.product} for ${DEMO.audience}`, cta: 'Learn more' },
        colors: [s.generationDNA.colorLanguage.primary, s.generationDNA.colorLanguage.surface],
        brand: { companyName: DEMO.company, tagline: DEMO.product },
        designDna: {
          composition: s.generationDNA.composition, hierarchy: s.generationDNA.hierarchy,
          typography: s.generationDNA.typography, spacing: s.generationDNA.spacing,
          photography: s.generationDNA.photography, illustration: s.generationDNA.illustration,
          renderingStyle: s.generationDNA.renderingStyle, shapeLanguage: s.generationDNA.shapeLanguage,
          camera: s.generationDNA.camera, lighting: s.generationDNA.lighting,
        },
      });
      const dir = path.join(DIR, s.sampleId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'carousel.png'), buffer);
      ok += 1;
      if (ok % 10 === 0) console.error(`[run] ${ok}/${samples.length}…`);
    } catch (e) {
      failures.push({ id: s.sampleId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 10) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
