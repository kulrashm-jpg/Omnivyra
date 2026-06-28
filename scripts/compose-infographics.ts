/**
 * CREATOR-106 — compose INFOGRAPHIC-format previews: a clean data layout (title +
 * hero image band + stat cards + bar chart) built on the AI preview.png, in the
 * blueprint's accent color. So the infographic gallery shows infographic-SHAPED,
 * text-formatted previews. Writes infographic.png. Pure compositing (sharp), no AI.
 *
 *   npx tsx scripts/compose-infographics.ts
 *   SAMPLE_ID=technology npx tsx scripts/compose-infographics.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { listSamples, getSample } from '../lib/creator-outcomes/marketingSample';
import type { MarketingSample } from '../lib/creator-outcomes/marketingSample';

const W = 1024, H = 1024;
const STATS = [{ n: '3.2x', l: 'More leads' }, { n: '+48%', l: 'Conversion' }, { n: '12k', l: 'Active users' }];
const BARS = [38, 52, 61, 78, 96];

function hex(s: string): string { return /^#[0-9a-f]{6}$/i.test(s) ? s : '#2563eb'; }

async function infographic(src: Buffer, accent: string): Promise<Buffer> {
  const heroW = W - 120, heroH = 300, heroX = 60, heroY = 150;
  const hero = await sharp(src).resize(heroW, heroH, { fit: 'cover' }).png().toBuffer();
  const statY = 500, cardW = 288, gap = 16, startX = 60;
  const cards = STATS.map((s, i) => {
    const x = startX + i * (cardW + gap);
    return `<rect x="${x}" y="${statY}" width="${cardW}" height="150" rx="14" fill="#f1f5f9"/>`
      + `<text x="${x + 24}" y="${statY + 78}" font-family="Arial, sans-serif" font-size="52" font-weight="bold" fill="${accent}">${s.n}</text>`
      + `<text x="${x + 26}" y="${statY + 118}" font-family="Arial, sans-serif" font-size="22" fill="#475569">${s.l}</text>`;
  }).join('');
  const chartX = 60, chartBase = 880, chartH = 170, bw = 150, bgap = 38;
  const bars = BARS.map((v, i) => {
    const h = Math.round((v / 100) * chartH);
    const x = chartX + i * (bw + bgap);
    return `<rect x="${x}" y="${chartBase - h}" width="${bw}" height="${h}" rx="6" fill="${accent}" opacity="${0.45 + i * 0.13}"/>`;
  }).join('');
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="60" y="64" width="56" height="8" rx="4" fill="${accent}"/>
    <text x="60" y="118" font-family="Arial, sans-serif" font-size="46" font-weight="bold" fill="#0f172a">CRM Impact Report</text>
    <text x="62" y="150" font-family="Arial, sans-serif" font-size="22" fill="#64748b">How small teams grow with our platform</text>
    <text x="60" y="480" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#0f172a">Results that compound</text>
    ${cards}
    <text x="60" y="700" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#0f172a">Pipeline growth</text>
    <line x1="60" y1="${chartBase}" x2="${W - 60}" y2="${chartBase}" stroke="#e2e8f0" stroke-width="2"/>
    ${bars}
    <text x="60" y="940" font-family="Arial, sans-serif" font-size="18" fill="#94a3b8">Source: platform analytics · representative sample</text>
  </svg>`;
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: hero, top: heroY, left: heroX }, { input: Buffer.from(svg), top: 0, left: 0 }])
    .png().toBuffer();
}

void (async () => {
  const single = process.env.SAMPLE_ID;
  const samples: MarketingSample[] = single ? [getSample(single)].filter(Boolean) as MarketingSample[] : listSamples('infographic');
  console.error(`[info] ${samples.length} infographic blueprints`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];
  for (const s of samples) {
    const dir = path.join(process.cwd(), 'public', 'creator-showcases', s.sampleId);
    const src = path.join(dir, 'preview.png');
    if (!existsSync(src)) { failures.push({ id: s.sampleId, error: 'no preview.png' }); continue; }
    try { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'infographic.png'), await infographic(readFileSync(src), hex(s.generationDNA.colorLanguage.primary))); ok += 1; }
    catch (e) { failures.push({ id: s.sampleId, error: e instanceof Error ? e.message : String(e) }); }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 8) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
