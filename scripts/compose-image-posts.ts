/**
 * CREATOR-106 — compose finished IMAGE-post previews from the AI preview.png: the real
 * AI visual + a clean marketing text overlay (headline + subhead + CTA on a bottom
 * scrim) so the image gallery shows finished, text-formatted posts. Writes image.png.
 * Pure compositing (sharp) — no AI cost. Run AFTER generate-ai-previews.ts.
 *
 *   npx tsx scripts/compose-image-posts.ts            # all image blueprints
 *   SAMPLE_ID=real-photography npx tsx scripts/compose-image-posts.ts   # one
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { listSamples, getSample } from '../lib/creator-outcomes/marketingSample';
import type { MarketingSample } from '../lib/creator-outcomes/marketingSample';

const W = 1024, H = 1024;
const HEAD = 'Generate Leads';
const SUB = 'A CRM built for small business';
const CTA = 'Learn more';

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function post(src: Buffer): Promise<Buffer> {
  const base = await sharp(src).resize(W, H, { fit: 'cover' }).png().toBuffer();
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(2,6,23,0)"/>
      <stop offset="50%" stop-color="rgba(2,6,23,0)"/>
      <stop offset="100%" stop-color="rgba(2,6,23,0.85)"/></linearGradient></defs>
    <rect x="0" y="${Math.round(H * 0.42)}" width="${W}" height="${Math.round(H * 0.58)}" fill="url(#scrim)"/>
    <text x="64" y="${H - 150}" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="bold" fill="#ffffff">${esc(HEAD)}</text>
    <text x="66" y="${H - 108}" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#e2e8f0">${esc(SUB)}</text>
    <rect x="64" y="${H - 82}" width="196" height="50" rx="25" fill="#2563eb"/>
    <text x="162" y="${H - 49}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(CTA)}</text>
  </svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

void (async () => {
  const single = process.env.SAMPLE_ID;
  const samples: MarketingSample[] = single ? [getSample(single)].filter(Boolean) as MarketingSample[] : listSamples('image');
  console.error(`[img] ${samples.length} image blueprints`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];
  for (const s of samples) {
    const dir = path.join(process.cwd(), 'public', 'creator-showcases', s.sampleId);
    const src = path.join(dir, 'preview.png');
    if (!existsSync(src)) { failures.push({ id: s.sampleId, error: 'no preview.png' }); continue; }
    try { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'image.png'), await post(readFileSync(src))); ok += 1; }
    catch (e) { failures.push({ id: s.sampleId, error: e instanceof Error ? e.message : String(e) }); }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 8) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
