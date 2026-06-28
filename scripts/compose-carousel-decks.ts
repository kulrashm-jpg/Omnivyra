/**
 * CREATOR-106 — compose carousel.png decks from the AI-generated preview.png. Reads
 * each carousel blueprint's AI preview and composes a 3-slide peeking deck with page
 * dots, so the carousel gallery shows asset-shaped previews built on the real AI image.
 * Pure compositing (sharp) — no AI, no extra cost. Run AFTER generate-ai-previews.ts.
 *
 *   npx tsx scripts/compose-carousel-decks.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { listSamples } from '../lib/creator-outcomes/marketingSample';

const S = 1080;
const card = 700;
const fc = card + 24;

async function framedSlide(srcPng: Buffer, withText: boolean): Promise<Buffer> {
  let img = await sharp(srcPng).resize(card, card, { fit: 'cover' }).png().toBuffer();
  if (withText) {
    const svg = `<svg width="${card}" height="${card}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="52%" stop-color="rgba(2,6,23,0)"/><stop offset="100%" stop-color="rgba(2,6,23,0.82)"/></linearGradient></defs>
      <rect x="0" y="${Math.round(card * 0.5)}" width="${card}" height="${Math.round(card * 0.5)}" fill="url(#s)"/>
      <text x="44" y="${card - 70}" font-family="Arial, sans-serif" font-size="46" font-weight="bold" fill="#ffffff">Generate Leads</text>
      <text x="46" y="${card - 34}" font-family="Arial, sans-serif" font-size="22" fill="#e2e8f0">Swipe to see how →</text>
    </svg>`;
    img = await sharp(img).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
  }
  return sharp(img).extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' }).png().toBuffer();
}

async function deck(srcPng: Buffer): Promise<Buffer> {
  const framed = await framedSlide(srcPng, false);
  const front = await framedSlide(srcPng, true);
  const dotY = S - 70;
  const dots = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">`
    + `<circle cx="${S / 2 - 30}" cy="${dotY}" r="8" fill="#2563eb"/>`
    + `<circle cx="${S / 2}" cy="${dotY}" r="8" fill="#cbd5e1"/>`
    + `<circle cx="${S / 2 + 30}" cy="${dotY}" r="8" fill="#cbd5e1"/></svg>`;
  return sharp({ create: { width: S, height: S, channels: 4, background: { r: 226, g: 232, b: 240, alpha: 1 } } })
    .composite([
      { input: framed, top: 95, left: S - fc - 70 },
      { input: framed, top: 135, left: Math.round((S - fc) / 2) },
      { input: front, top: 175, left: 70 },
      { input: Buffer.from(dots), top: 0, left: 0 },
    ]).png().toBuffer();
}

void (async () => {
  const samples = listSamples('carousel');
  console.error(`[deck] ${samples.length} carousel blueprints`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];
  for (const s of samples) {
    const dir = path.join(process.cwd(), 'public', 'creator-showcases', s.sampleId);
    const src = path.join(dir, 'preview.png');
    if (!existsSync(src)) { failures.push({ id: s.sampleId, error: 'no preview.png' }); continue; }
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'carousel.png'), await deck(readFileSync(src)));
      ok += 1;
    } catch (e) { failures.push({ id: s.sampleId, error: e instanceof Error ? e.message : String(e) }); }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 8) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
