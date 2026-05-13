import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-review-placeholder-service-role-key';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'local-review-placeholder-anon-key';
process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const PLATFORMS = ['linkedin', 'x', 'instagram', 'facebook', 'threads', 'reddit'] as const;
const ASSET_TYPES = ['image', 'banner', 'infographic'] as const;

const outputDir = path.join(process.cwd(), 'tmp', 'creator-visual-review');

const overlay = {
  hook: 'Stop losing demand after the click',
  headline: 'Turn search interest into qualified pipeline',
  keyInsight: 'High-intent pages are attracting attention, but the message needs a sharper conversion path.',
  cta: 'Review the gaps',
  supportingText: 'Built from Writer content, rendered as platform-native creative.',
};

async function main() {
  const { renderCreatorAssetReviewPreview } = await import('../backend/services/creatorAssetRenderer');
  await mkdir(outputDir, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];

  for (const assetType of ASSET_TYPES) {
    for (const platform of PLATFORMS) {
      const rendered = await renderCreatorAssetReviewPreview({
        assetType,
        platform,
        overlayText: overlay,
        title: overlay.headline,
        body: overlay.keyInsight,
        colors: ['#0F172A', '#2F80ED', '#14B8A6'],
        brand: {
          companyName: 'OmniVyra',
          tagline: 'Performance intelligence for sharper growth',
        },
      });
      const fileName = `${assetType}-${platform}.png`;
      await writeFile(path.join(outputDir, fileName), rendered.buffer);
      manifest.push({
        assetType,
        platform,
        fileName,
        ...rendered.metadata,
      });
    }
  }

  const html = [
    '<!doctype html><html><head><meta charset="utf-8" />',
    '<title>Creator Visual Review Samples</title>',
    '<style>body{font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px}h1{margin:0 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:18px;padding:14px;box-shadow:0 8px 30px rgba(15,23,42,.06)}img{width:100%;height:280px;object-fit:contain;background:#f1f5f9;border-radius:12px}.meta{font-size:12px;color:#475569;line-height:1.5;white-space:pre-wrap}.pill{display:inline-block;background:#e2e8f0;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700;margin-right:6px}</style>',
    '</head><body><h1>Creator Visual Review Samples</h1>',
    '<p>Deterministic compositor samples across image, banner, infographic, and supported social platforms.</p>',
    '<div class="grid">',
    ...manifest.map((item) => {
      const quality = item.overlay_quality as { score?: number; preset?: string; flags?: string[] };
      return `<div class="card"><img src="./${item.fileName}" /><h3>${item.assetType} / ${item.platform}</h3><p><span class="pill">Score ${quality?.score ?? 'n/a'}</span><span class="pill">${quality?.preset ?? 'unknown'}</span></p><div class="meta">${(quality?.flags || []).join('\\n') || 'No flags'}</div></div>`;
    }),
    '</div></body></html>',
  ].join('');

  await writeFile(path.join(outputDir, 'index.html'), html);
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Generated ${manifest.length} Creator visual review samples in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
