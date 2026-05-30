// Quick numerical sanity check of the yield model against the spec examples.
// Replicates the formulas from sourceRecommendationEngine.ts without imports.

const VOLUME_FLOOR = 30, VOLUME_CEILING = 250;
const YIELD_HIGH = 0.65, YIELD_MEDIUM = 0.35;
const clamp01 = x => Math.max(0, Math.min(1, x));
const normalizeVolume = v => v <= VOLUME_FLOOR ? 0 : v >= VOLUME_CEILING ? 1 : (v - VOLUME_FLOOR) / (VOLUME_CEILING - VOLUME_FLOOR);
const bucket = s => s >= YIELD_HIGH ? 'High' : s >= YIELD_MEDIUM ? 'Medium' : 'Low';

function yieldOf(name, signal_quality, raw_volume, strategic_relevance, max_potential) {
  const sq = clamp01(signal_quality);
  const sv = clamp01(normalizeVolume(raw_volume));
  const lp = clamp01(strategic_relevance * 0.4 + max_potential * 0.4 + sq * 0.2);
  const de = clamp01(sq * 0.7 + sv * 0.3);
  console.log(`${name}:`);
  console.log(`  Lead Potential:        ${bucket(lp)}   (${lp.toFixed(3)})`);
  console.log(`  Signal Volume:         ${bucket(sv)}   (${sv.toFixed(3)})`);
  console.log(`  Signal Quality:        ${bucket(sq)}   (${sq.toFixed(3)})`);
  console.log(`  Discovery Efficiency:  ${bucket(de)}   (${de.toFixed(3)})`);
  console.log();
}

// Spec: Reddit Community -> High / Medium / High / High
// Use SUBREDDIT seed-default-ish numbers + strong context match
yieldOf('Reddit (r/SaaS-like)',
  /* signal_quality   */ 0.72,
  /* raw_volume       */ 150,
  /* strategic_rel    */ 0.70,
  /* max_potential    */ 0.65,
);

// Spec: X -> Medium / High / Low / Medium
yieldOf('X list',
  /* signal_quality   */ 0.30,
  /* raw_volume       */ 240,
  /* strategic_rel    */ 0.50,
  /* max_potential    */ 0.50,
);
