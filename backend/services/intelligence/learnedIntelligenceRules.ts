import type { LearnedPattern } from './intelligenceQueries';

/**
 * Data-driven rules that replace the static heuristics once
 * `intelligence_patterns` has enough samples. The core idea:
 *
 *   - Treat each pattern family (length / question / emoji) as a
 *     two-way comparison. Pick the winner (higher success_rate).
 *   - Emit a human-readable insight using the winner's uplift.
 *   - Emit a `comparisons[]` array of every family that has enough
 *     samples so the UI can surface relative uplifts.
 *   - Pick a recommendation by mapping the top winning pattern back
 *     to a recommendation action.
 *
 * Gating: we require a minimum sample size per pattern AND a minimum
 * uplift delta over baseline, otherwise the family is ignored. This
 * prevents tiny data from producing noisy recommendations.
 */

const MIN_SAMPLES_PER_PATTERN = 10;
const MIN_UPLIFT_FOR_WINNER   = 1.1;   // 10% uplift over sibling to count as a win

type Family = 'length' | 'question' | 'emoji';

const FAMILY_OF: Record<string, Family> = {
  short_reply:  'length',
  long_reply:   'length',
  has_question: 'question',
  no_question:  'question',
  has_emoji:    'emoji',
  no_emoji:     'emoji',
};

export type LearnedComparison = {
  type: Family;
  winner: string;                // the winning pattern_type label
  winner_rate: number;
  baseline_rate: number | null;
  uplift_percent: number | null; // ((winner_rate / baseline_rate) - 1) * 100
  uplift_label: string;          // formatted "+38%" or "2.1×" when uplift is large
  sample_size: number;
};

export type LearnedRecommendation = {
  type: 'dm_followup' | 'short_reply' | 'long_reply' | 'ask_question' | 'use_emoji' | 'avoid_emoji';
  label: string;
  pattern_type: string;
};

function formatUplift(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '';
  if (percent >= 100) {
    const ratio = 1 + percent / 100;
    return `${ratio.toFixed(1)}×`;
  }
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${Math.round(percent)}%`;
}

/**
 * Group learned patterns by family and pick the winner within each
 * family. Returns one comparison per family that has BOTH siblings
 * over the minimum sample threshold and a meaningful uplift.
 */
export function computeComparisons(patterns: LearnedPattern[]): LearnedComparison[] {
  const byFamily = new Map<Family, LearnedPattern[]>();
  for (const p of patterns) {
    const fam = FAMILY_OF[p.pattern_type];
    if (!fam) continue;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(p);
  }

  const out: LearnedComparison[] = [];
  for (const [family, group] of byFamily) {
    if (group.length < 2) continue;
    const qualified = group.filter((p) => p.sample_size >= MIN_SAMPLES_PER_PATTERN);
    if (qualified.length < 2) continue;
    // Pick the pair with the largest margin.
    qualified.sort((a, b) => b.success_rate - a.success_rate);
    const winner = qualified[0];
    const loser  = qualified[qualified.length - 1];
    if (winner.success_rate <= 0 && loser.success_rate <= 0) continue;
    // Use the learner's baseline_rate when present (covers edge cases
    // where the family has more than 2 active siblings), else fall
    // back to the loser's observed rate.
    const baseline = winner.baseline_rate ?? (loser.success_rate > 0 ? loser.success_rate : null);
    if (baseline == null || baseline === 0) {
      // Still emit a comparison but uplift is undefined.
      out.push({
        type: family,
        winner: winner.pattern_type,
        winner_rate: winner.success_rate,
        baseline_rate: baseline,
        uplift_percent: null,
        uplift_label: '',
        sample_size: winner.sample_size,
      });
      continue;
    }
    const ratio = winner.success_rate / baseline;
    if (ratio < MIN_UPLIFT_FOR_WINNER) continue;
    const upliftPercent = (ratio - 1) * 100;
    out.push({
      type: family,
      winner: winner.pattern_type,
      winner_rate: Number(winner.success_rate.toFixed(4)),
      baseline_rate: Number(baseline.toFixed(4)),
      uplift_percent: Number(upliftPercent.toFixed(2)),
      uplift_label: formatUplift(upliftPercent),
      sample_size: winner.sample_size,
    });
  }
  // Prefer comparisons with higher uplift and higher sample first.
  out.sort((a, b) => {
    const au = a.uplift_percent ?? 0;
    const bu = b.uplift_percent ?? 0;
    if (bu !== au) return bu - au;
    return b.sample_size - a.sample_size;
  });
  return out;
}

/**
 * Build a learned-insight line from the strongest comparison. Falls
 * back to `null` (caller should use the static rule layer).
 */
export function computeLearnedInsight(comparisons: LearnedComparison[]): string | null {
  if (comparisons.length === 0) return null;
  const top = comparisons[0];
  const uplift = top.uplift_label;

  const humanWinner: Record<string, string> = {
    short_reply: 'Short replies',
    long_reply:  'Long replies',
    has_question:'Replies with questions',
    no_question: 'Replies without questions',
    has_emoji:   'Replies with emoji',
    no_emoji:    'Replies without emoji',
  };
  const siblingOf: Record<string, string> = {
    short_reply: 'long replies',
    long_reply:  'short replies',
    has_question:'replies without questions',
    no_question: 'replies with questions',
    has_emoji:   'replies without emoji',
    no_emoji:    'replies with emoji',
  };

  const winner = humanWinner[top.winner];
  if (!winner) return null;
  const sibling = siblingOf[top.winner] || 'the alternative';

  if (uplift.endsWith('×')) {
    return `${winner} outperform ${sibling} by ${uplift} for your audience`;
  }
  if (uplift) {
    return `${winner} perform ${uplift} better than ${sibling} for your audience`;
  }
  return `${winner} perform better for your audience`;
}

/**
 * Map the top winning pattern onto a recommendation the UI can render.
 * Returns null when no comparison is strong enough.
 */
export function computeLearnedRecommendation(
  comparisons: LearnedComparison[],
): LearnedRecommendation | null {
  for (const cmp of comparisons) {
    switch (cmp.winner) {
      case 'short_reply':  return { type: 'short_reply',  pattern_type: 'short_reply',  label: 'Try a shorter reply (≤120 chars)' };
      case 'long_reply':   return { type: 'long_reply',   pattern_type: 'long_reply',   label: 'Try a longer, more detailed reply' };
      case 'has_question': return { type: 'ask_question', pattern_type: 'has_question', label: 'Ask a question to spark a reply' };
      case 'has_emoji':    return { type: 'use_emoji',    pattern_type: 'has_emoji',    label: 'Add an emoji — they perform better here' };
      case 'no_emoji':     return { type: 'avoid_emoji',  pattern_type: 'no_emoji',     label: 'Skip emoji — plain text performs better here' };
      default: continue;
    }
  }
  return null;
}
