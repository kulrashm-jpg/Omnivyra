#!/usr/bin/env node
/**
 * PARITY GATE (deploy-time) — render-text capability.
 *
 * Standalone, dependency-light mirror of
 * backend/services/renderTextCapabilityProbe.ts. Runs the SAME rasterizer the
 * creator engine uses (sharp → librsvg → fontconfig) on a known text SVG and
 * measures ink. Designed to run in TWO places:
 *   1. predeploy-check.js on the dev box — catches render-CODE regressions.
 *   2. INSIDE the worker Docker image in CI — catches the ENV/FONT gap that
 *      shipped blank infographics in prod while localhost rendered text.
 *
 * This is the fail-closed half of the parity contract (the worker boot
 * preflight is the runtime-visibility half). Keep the SVG/threshold in sync
 * with renderTextCapabilityProbe.ts.
 *
 * Exit codes:
 *   0 — text renders (glyphs inked) → parity OK
 *   1 — BLANK / no glyphs (fonts missing) → BLOCK deploy
 *   2 — environmental (sharp unavailable) → caller decides (skip)
 */
const INK_THRESHOLD = 0.004;
const WHITE_CUTOFF = 200;
const FAMILY = process.env.PARITY_FONT_FAMILY || 'Inter, Arial';

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="64">` +
  `<rect width="256" height="64" fill="#ffffff"/>` +
  `<text x="12" y="44" font-size="34" font-weight="700" ` +
  `font-family="${FAMILY}" fill="#000000">Parity 123 ABC</text>` +
  `</svg>`;

(async () => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error(`[render-parity] sharp unavailable in this shell: ${e.message}`);
    process.exit(2);
  }
  try {
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const total = info.width * info.height;
    let ink = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] < WHITE_CUTOFF || data[i + 1] < WHITE_CUTOFF || data[i + 2] < WHITE_CUTOFF) ink++;
    }
    const ratio = total ? ink / total : 0;
    if (ratio >= INK_THRESHOLD) {
      console.log(`[render-parity] OK — text renders (ink=${ratio.toFixed(4)}, family="${FAMILY}")`);
      process.exit(0);
    }
    console.error(
      `[render-parity] BLOCKED — text did NOT render (ink=${ratio.toFixed(4)} < ${INK_THRESHOLD}).\n` +
      `  Fonts are missing for "${FAMILY}" in this environment.\n` +
      `  Infographics / brand_cards would render BLANK here (the prod regression).\n` +
      `  Install fonts (see Dockerfile.worker: fontconfig + fonts-liberation + fc-cache).`,
    );
    process.exit(1);
  } catch (e) {
    console.error(`[render-parity] render errored: ${e.message}`);
    process.exit(2);
  }
})();
