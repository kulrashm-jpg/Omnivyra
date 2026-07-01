/**
 * Beta AI render mode (BETA-020 RULE 4).
 *
 * When BETA_AI_MODE is enabled, the creator image pipeline returns a DETERMINISTIC fixture
 * image instead of calling OpenAI — so the authenticated runtime journey (Writer → POST+IMAGE /
 * TEXT INSIDE IMAGE → editor → regenerate → download) can be exercised end-to-end with ZERO
 * production credit spend. The fixture is generated locally with sharp (no network, no cost) and
 * varies deterministically by prompt so different assets look different while the SAME prompt
 * always yields byte-identical output (reproducible tests / stable Playwright snapshots).
 *
 * Production-safe: off by default. When BETA_AI_MODE is unset the pipeline behaves byte-identically
 * to before (the caller falls straight through to the real OpenAI provider).
 */
import sharp from 'sharp';

export const BETA_MOCK_MODEL = 'beta-mock';
const BETA_MOCK_SIZE = 1024;

/** True only when the Beta AI render mode is explicitly enabled. */
export function isBetaAiRenderMode(): boolean {
  const v = process.env.BETA_AI_MODE;
  return v === '1' || v === 'true';
}

/** Deterministic FNV-1a → a mid-tone RGB colour (kept in a legible range). */
function hashColor(seed: string): { r: number; g: number; b: number } {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return { r: 48 + (h & 0x7f), g: 48 + ((h >>> 8) & 0x7f), b: 48 + ((h >>> 16) & 0x7f) };
}

/**
 * A deterministic, zero-cost fixture image (valid PNG) for Beta AI mode. Two-tone (base colour +
 * a lighter lower band) so it reads as a real image and varies by prompt, with no AI and no
 * randomness/clock — identical prompt ⇒ identical bytes.
 */
export async function createBetaMockImage(prompt: string, sizePx: number = BETA_MOCK_SIZE): Promise<Buffer> {
  const seed = prompt || 'beta';
  const base = hashColor(seed);
  const accent = hashColor(seed + '::accent');
  const bandTop = Math.round(sizePx * 0.62);
  const svg = `<svg width="${sizePx}" height="${sizePx}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="${bandTop}" width="${sizePx}" height="${sizePx - bandTop}" fill="rgb(${accent.r},${accent.g},${accent.b})" opacity="0.55"/>`
    + `</svg>`;
  return sharp({ create: { width: sizePx, height: sizePx, channels: 3, background: base } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
