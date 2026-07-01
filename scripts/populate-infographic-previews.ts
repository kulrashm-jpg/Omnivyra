/**
 * CREATOR-110 — gallery infographic previews are produced by the PRODUCTION renderer
 * (renderInfographicAsset), the SAME one customer generation uses. No bespoke composer.
 * For each infographic sample it builds a demo asset_payload (identical demo brief, only
 * blueprint_id changes), renders via renderInfographicAsset({ previewBufferOnly:true }),
 * and writes public/creator-showcases/<id>/infographic.webp. Local-only: no AI (the copy
 * composer falls back to static content), no Storage upload, no DB.
 *
 *   npx tsx scripts/populate-infographic-previews.ts
 *   SAMPLE_ID=technology npx tsx scripts/populate-infographic-previews.ts   # one
 */

// Minimal local env so config/env.schema validation passes (never touches prod).
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'local-dev-service-role-key',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-dev-anon-key',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};
for (const [k, v] of Object.entries(LOCAL_ENV)) if (!process.env[k]) process.env[k] = v;

const DEMO = {
  topic: 'How small teams grow with our platform',
  summary: 'A clear view of what moves the needle for SMB teams.',
  sections: ['Faster onboarding', 'Higher conversion', 'Lower churn', 'Stronger retention'],
  cta: 'Learn more',
};

void (async () => {
  const path = await import('path');
  const { mkdirSync, writeFileSync } = await import('fs');
  const sharp = (await import('sharp')).default;
  const { listSamples, getSample } = await import('../lib/creator-outcomes/marketingSample');
  const { renderInfographicAsset } = await import('../backend/services/creatorAssetRenderer');

  const DIR = path.join(process.cwd(), 'public', 'creator-showcases');
  const single = process.env.SAMPLE_ID;
  const samples = single ? [getSample(single)].filter(Boolean) as ReturnType<typeof listSamples> : listSamples('infographic');
  console.error(`[ig] ${samples.length} infographic sample(s) via renderInfographicAsset`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];

  for (const s of samples) {
    try {
      const assetPayload = {
        media_bundle: {
          metadata: {
            platform: 'linkedin',
            topic: DEMO.topic,
            summary: DEMO.summary,
            cta: DEMO.cta,
            brand_mode: 'independent',
            // Same canonical thread customer generation uses (CREATOR-106/107/108).
            blueprint_id: s.sampleId,
            blueprint_color_primary: s.generationDNA.colorLanguage.primary,
            creator_card: { blueprint_id: s.sampleId, blueprint_color_primary: s.generationDNA.colorLanguage.primary },
            thread_visual_transform: { items: DEMO.sections },
          },
        },
      };
      const { buffer } = await renderInfographicAsset(assetPayload, { companyId: null, previewBufferOnly: true });
      if (!buffer) throw new Error('renderInfographicAsset returned no buffer');
      const dir = path.join(DIR, s.sampleId);
      mkdirSync(dir, { recursive: true });
      const webp = await sharp(buffer).webp({ quality: 82, alphaQuality: 100, effort: 4 }).toBuffer();
      writeFileSync(path.join(dir, 'infographic.webp'), webp);
      ok += 1;
      if (ok % 10 === 0) console.error(`[ig] ${ok}/${samples.length}…`);
    } catch (e) {
      failures.push({ id: s.sampleId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 8) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
