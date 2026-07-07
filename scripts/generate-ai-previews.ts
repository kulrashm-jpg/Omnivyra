/**
 * CREATOR-106 — AI-generated sample previews. For each blueprint it calls the SAME
 * image provider customer generation uses (OpenAI gpt-image-1) with the blueprint's
 * own style prompt, producing a genuinely style-distinct preview. Writes
 * public/creator-showcases/<id>/<OUT>. Spends real OpenAI credits (user-authorized).
 *
 *   SAMPLE_ID=real-photography OUT=preview_ai.webp npx tsx scripts/generate-ai-previews.ts   # test one
 *   FAMILY=image LIMIT=5 npx tsx scripts/generate-ai-previews.ts                            # batch
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { listSamples, getSample } from '../lib/creator-outcomes/marketingSample';
import type { MarketingSample } from '../lib/creator-outcomes/marketingSample';

function loadKey(): string {
  const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
  const k = m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  if (!k) throw new Error('OPENAI_API_KEY not found in .env.local');
  return k;
}

const SUBJECT = 'a modern B2B SaaS CRM platform for small businesses';
function promptFor(s: MarketingSample): string {
  return `High-quality marketing visual for ${SUBJECT}. Visual style: ${s.generationDNA.promptModifiers}. `
    + `Polished, editorial, professional composition. `
    // CREATOR-106 hardening: the generic no-text ban was insufficient for screen
    // scenes — gpt-image-1 bakes GARBLED words/numbers into any dashboard/UI it
    // draws (the SUBJECT skews toward screens). Add the same screen-abstract
    // override the live renderer uses so interfaces render as pure abstract shapes
    // with zero readable glyphs/digits.
    + `ABSOLUTE OVERRIDE (highest priority): strictly no text, words, letters, numbers, digits, captions, labels, signage, logos, wordmarks, monograms, or brand/company/product names anywhere in the image — including on any screen, dashboard, chart, table, UI, device, paper, wall, packaging, or apparel. Render every screen, dashboard, chart, table, graph, or interface as ABSTRACT blurred shapes, bars, and anonymized gradients with NO readable glyphs, labels, or numbers of any kind. Do not depict any name, label, or number even if the style described one.`;
}

async function genOne(key: string, s: MarketingSample, out: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: promptFor(s).slice(0, 3800), n: 1, size: '1024x1024', quality: 'medium' }),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    const json: any = await resp.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, error: 'no b64_json in response' };
    const dir = path.join(process.cwd(), 'public', 'creator-showcases', s.sampleId);
    mkdirSync(dir, { recursive: true });
    const raw = Buffer.from(b64, 'base64');
    // Runtime serves WebP; transcode when the output is .webp, otherwise write raw (OUT override).
    const data = out.endsWith('.webp') ? await sharp(raw).webp({ quality: 82, alphaQuality: 100, effort: 4 }).toBuffer() : raw;
    writeFileSync(path.join(dir, out), data);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

void (async () => {
  const key = loadKey();
  const out = process.env.OUT || 'preview.webp';
  const single = process.env.SAMPLE_ID;
  const family = process.env.FAMILY as 'image' | 'carousel' | 'infographic' | undefined;
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

  let samples: MarketingSample[];
  if (single) { const s = getSample(single); samples = s ? [s] : []; }
  else samples = listSamples(family).slice(0, limit ?? undefined);

  console.error(`[ai] generating ${samples.length} preview(s) -> ${out} (gpt-image-1, medium)`);
  let ok = 0; const failures: Array<{ id: string; error: string }> = [];
  for (const s of samples) {
    const r = await genOne(key, s, out);
    if (r.ok) { ok += 1; console.error(`[ai] ✓ ${s.sampleId}`); }
    else { failures.push({ id: s.sampleId, error: r.error! }); console.error(`[ai] ✗ ${s.sampleId}: ${r.error}`); }
  }
  console.log(JSON.stringify({ total: samples.length, succeeded: ok, failed: failures.length, failures: failures.slice(0, 10) }, null, 2));
  process.exit(failures.length && ok === 0 ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
