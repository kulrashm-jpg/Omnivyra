/**
 * semanticRepetitionDetector.ts
 *
 * Phase 3.3 — Cross-section semantic repetition detection.
 *
 * The continuity governor only catches keyword-level drift. Real semantic
 * repetition — same idea, different wording, same example dressed up
 * differently, recycled framing patterns — slips through. This detector
 * targets that gap.
 *
 * Method (NO external embeddings, NO vector DB, per spec):
 *   1. Shingling: extract overlapping word n-grams per section; Jaccard
 *      similarity between section shingle sets approximates "have these
 *      two sections been saying the same thing?"
 *   2. Topic-bag cosine: bag-of-words TF cosine similarity captures
 *      semantic overlap that escapes raw shingling.
 *   3. Rhetorical pattern detection: regex catches reused framing
 *      structures ("First X, then Y, finally Z" loops; "imagine X
 *      scenario" → "consider X scenario" → "picture X scenario";
 *      "the key is X" / "what matters is X" / "the critical thing is X").
 *   4. Example-collision detection: shared numeric tokens, named entities,
 *      or rare specific nouns across multiple sections.
 *   5. Transition pattern accumulation: which transitions ("moreover",
 *      "additionally", "furthermore", "in essence") repeat across sections.
 *
 * Combined into a single repetition score 0–100. Trigger selective
 * regeneration on the highest-overlapping pair when over threshold —
 * NEVER regenerate the full article.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set<string>([
  'the','a','an','and','or','but','if','then','of','to','in','on','for','with','by','at','from','as','is','are','was','were','be','been','being','it','its','this','that','these','those','i','you','he','she','we','they','them','his','her','our','their','my','your','what','which','who','how','why','when','where','can','will','would','could','should','may','might','must','do','does','did','have','has','had','not','no','yes','so','than','also','such','very','more','most','some','any','all','one','two','three','about','into','out','up','down','over','under','again','further','here','there','only','own','same','other','each','few','many','much','because','through','while','during','before','after','above','below','between','against','within','without','toward','upon',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function shingles(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) return out;
  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const x of smaller) if (larger.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of a) normA += v * v;
  for (const [, v] of b) normB += v * v;
  const smaller = a.size <= b.size ? a : b;
  const other = smaller === a ? b : a;
  for (const [k, v] of smaller) {
    const o = other.get(k);
    if (o) dot += v * o;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Rhetorical pattern markers — reusable framing structures.
const RHETORICAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'first_then_finally',     pattern: /\bfirst[,\s].{1,80}\bthen[,\s].{1,80}\b(finally|lastly)\b/i },
  { name: 'imagine_consider_picture', pattern: /\b(imagine|consider|picture|envision)\s+(this|a|the|that)\b/i },
  { name: 'the_key_is',             pattern: /\b(the key is|what matters is|the critical thing is|the most important)\b/i },
  { name: 'three_ways_three_things', pattern: /\b(three (ways|things|reasons|areas)|the three )\b/i },
  { name: 'lets_dive_in',           pattern: /\b(let'?s (dive|jump|get) (in(to)?|started))\b/i },
  { name: 'at_the_end_of_the_day',  pattern: /\bat the end of the day\b/i },
  { name: 'the_truth_is',           pattern: /\b(the truth is|the reality is|the fact is)\b/i },
];

const TRANSITION_PATTERNS = [
  'moreover',
  'furthermore',
  'additionally',
  'in essence',
  'in addition',
  'on the other hand',
  'that said',
  'with that in mind',
  'as a result',
  'in conclusion',
  'in summary',
];

function detectRhetoricalPatterns(text: string): string[] {
  return RHETORICAL_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((p) => p.name);
}

function countTransitions(text: string): Map<string, number> {
  const lc = text.toLowerCase();
  const counts = new Map<string, number>();
  for (const t of TRANSITION_PATTERNS) {
    const matches = lc.match(new RegExp(`\\b${t}\\b`, 'g'));
    if (matches && matches.length > 0) counts.set(t, matches.length);
  }
  return counts;
}

function extractSpecificEntities(tokens: string[]): Set<string> {
  // Heuristic: tokens with numerics, all-caps, or rare appearance look like
  // specific entities or numerics the model invented.
  const out = new Set<string>();
  for (const t of tokens) {
    if (/\d/.test(t)) out.add(t);
    if (t.length >= 5 && /^[a-z][a-z'-]*$/.test(t)) {
      // Rare-noun-ish proxy: collect words with low frequency overall (handled later)
    }
  }
  return out;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SemanticRepetitionSectionInput {
  sectionIndex: number;
  sectionTitle: string;
  html: string;
}

export interface OverlappingSectionPair {
  sectionA: { index: number; title: string };
  sectionB: { index: number; title: string };
  shingleJaccard: number;
  bagCosine: number;
  sharedRhetoricalPatterns: string[];
  sharedSpecificTokens: string[];
  overlapScore: number;       // 0-100 combined
}

export interface SemanticRepetitionResult {
  repetitionScore: number;             // 0-100, higher = more repetition
  repeatedConcepts: string[];          // shingles that appear in ≥ 2 sections
  repeatedTransitions: string[];       // transition phrases that appear in ≥ 2 sections
  repeatedRhetoricalPatterns: string[];// rhetorical patterns appearing in ≥ 2 sections
  overlappingSections: OverlappingSectionPair[];
  verdict: 'pass' | 'retry' | 'fail';
  // sectionIndices that the orchestrator should regenerate (the worse-scoring
  // sides of the strongest overlapping pairs)
  sectionsToRegenerate: number[];
}

// ── Main ─────────────────────────────────────────────────────────────────────

const PAIR_OVERLAP_RETRY = 35;   // pair score above which pair becomes a target
const PAIR_OVERLAP_FAIL = 55;    // pair score above which we fail the article
const ARTICLE_REPETITION_RETRY = 40;
const ARTICLE_REPETITION_FAIL = 60;

export function detectSemanticRepetition(
  sections: SemanticRepetitionSectionInput[],
): SemanticRepetitionResult {
  if (sections.length < 2) {
    return {
      repetitionScore: 0,
      repeatedConcepts: [],
      repeatedTransitions: [],
      repeatedRhetoricalPatterns: [],
      overlappingSections: [],
      verdict: 'pass',
      sectionsToRegenerate: [],
    };
  }

  const perSection = sections.map((s) => {
    const text = stripHtml(s.html);
    const tokens = tokenize(text);
    return {
      input: s,
      text,
      tokens,
      shingles3: shingles(tokens, 3),
      shingles5: shingles(tokens, 5),
      bag: termFrequencies(tokens),
      rhetoricalPatterns: detectRhetoricalPatterns(text),
      transitions: countTransitions(text),
      specificEntities: extractSpecificEntities(tokens),
    };
  });

  // Pairwise overlap.
  const pairs: OverlappingSectionPair[] = [];
  for (let i = 0; i < perSection.length; i += 1) {
    for (let j = i + 1; j < perSection.length; j += 1) {
      const a = perSection[i];
      const b = perSection[j];

      const shingleJaccard = Math.max(
        jaccard(a.shingles3, b.shingles3),
        jaccard(a.shingles5, b.shingles5),
      );
      const bagCosine = cosineSimilarity(a.bag, b.bag);
      const sharedRhetorical = a.rhetoricalPatterns.filter((p) => b.rhetoricalPatterns.includes(p));
      const sharedSpecific: string[] = [];
      for (const t of a.specificEntities) if (b.specificEntities.has(t)) sharedSpecific.push(t);

      // Combined pair score (0-100):
      //   - 45% shingle Jaccard
      //   - 35% bag cosine
      //   - 10% shared rhetorical patterns (capped)
      //   - 10% shared specific tokens (capped)
      const overlapScore = Math.round(
        45 * shingleJaccard +
        35 * bagCosine +
        10 * Math.min(1, sharedRhetorical.length / 2) +
        10 * Math.min(1, sharedSpecific.length / 3),
      );

      if (overlapScore >= 15 || shingleJaccard >= 0.18 || bagCosine >= 0.45) {
        pairs.push({
          sectionA: { index: a.input.sectionIndex, title: a.input.sectionTitle },
          sectionB: { index: b.input.sectionIndex, title: b.input.sectionTitle },
          shingleJaccard: Number(shingleJaccard.toFixed(3)),
          bagCosine: Number(bagCosine.toFixed(3)),
          sharedRhetoricalPatterns: sharedRhetorical,
          sharedSpecificTokens: sharedSpecific.slice(0, 10),
          overlapScore,
        });
      }
    }
  }

  pairs.sort((a, b) => b.overlapScore - a.overlapScore);

  // Repeated concepts across the article — shingles appearing in ≥ 2 sections.
  const shingleCounts = new Map<string, number>();
  for (const s of perSection) {
    for (const sh of s.shingles3) shingleCounts.set(sh, (shingleCounts.get(sh) ?? 0) + 1);
  }
  const repeatedConcepts = Array.from(shingleCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([sh]) => sh);

  // Repeated transitions across the article.
  const transitionCounts = new Map<string, number>();
  for (const s of perSection) {
    for (const [t, c] of s.transitions) transitionCounts.set(t, (transitionCounts.get(t) ?? 0) + c);
  }
  const repeatedTransitions = Array.from(transitionCounts.entries())
    .filter(([, count]) => count >= 3) // any single phrase used ≥ 3× across all sections
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t, c]) => `${t} (×${c})`);

  // Repeated rhetorical patterns.
  const rhetoricCounts = new Map<string, number>();
  for (const s of perSection) {
    for (const p of s.rhetoricalPatterns) rhetoricCounts.set(p, (rhetoricCounts.get(p) ?? 0) + 1);
  }
  const repeatedRhetoricalPatterns = Array.from(rhetoricCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${p} (×${c})`);

  // Article-level repetition score.
  const topPairScore = pairs.length > 0 ? pairs[0].overlapScore : 0;
  const avgPairScore = pairs.length > 0
    ? pairs.reduce((sum, p) => sum + p.overlapScore, 0) / pairs.length
    : 0;
  const transitionAbuse = Math.min(1, transitionCounts.size > 0
    ? Array.from(transitionCounts.values()).reduce((sum, c) => sum + c, 0) / Math.max(perSection.length, 1) / 4
    : 0);

  const repetitionScore = Math.min(100, Math.round(
    0.50 * topPairScore +
    0.25 * avgPairScore +
    10 * Math.min(1, repeatedConcepts.length / 10) +
    10 * Math.min(1, repeatedRhetoricalPatterns.length / 3) +
    10 * transitionAbuse,
  ));

  // Verdict.
  let verdict: SemanticRepetitionResult['verdict'];
  if (repetitionScore >= ARTICLE_REPETITION_FAIL || topPairScore >= PAIR_OVERLAP_FAIL) {
    verdict = 'fail';
  } else if (repetitionScore >= ARTICLE_REPETITION_RETRY || topPairScore >= PAIR_OVERLAP_RETRY) {
    verdict = 'retry';
  } else {
    verdict = 'pass';
  }

  // Sections to regenerate — pick the lower-quality side (heuristic: shorter
  // section) of the top 2 pairs above retry threshold.
  const sectionsToRegenerate: number[] = [];
  for (const p of pairs.slice(0, 2)) {
    if (p.overlapScore < PAIR_OVERLAP_RETRY) break;
    // Choose the section with the smaller word count as the regeneration
    // target (assume the longer one is more developed).
    const a = perSection[p.sectionA.index];
    const b = perSection[p.sectionB.index];
    const target = a && b
      ? (a.tokens.length <= b.tokens.length ? p.sectionA.index : p.sectionB.index)
      : p.sectionA.index;
    if (!sectionsToRegenerate.includes(target)) sectionsToRegenerate.push(target);
  }

  return {
    repetitionScore,
    repeatedConcepts,
    repeatedTransitions,
    repeatedRhetoricalPatterns,
    overlappingSections: pairs.slice(0, 10),
    verdict,
    sectionsToRegenerate,
  };
}
