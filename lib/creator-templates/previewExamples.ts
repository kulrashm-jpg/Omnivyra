/**
 * Multi-Outcome Preview Examples — deterministic, preview-metadata only.
 *
 * Produces 3–5 example outcomes for a template so the gallery can demonstrate
 * that the user is choosing a VISUAL STRUCTURE, not one piece of content. Each
 * example is ONLY sample copy in the template's existing structure (same field
 * set + same slide/section counts) — the gallery renders them with the SAME
 * `TemplatePreview`/style. NO new preview engine, NO generation, NO rendering,
 * NO contract/architecture change. Labels are preview metadata only and never
 * influence generation.
 *
 * Precedence: authored `preview.sample.examples` → derived industry examples
 * (system templates with content) → single existing preview (user templates /
 * empty samples).
 */

import type { CreatorTemplate, PreviewSampleContent } from './types';

export interface PreviewExample {
  /** Small context label (e.g. an industry) — illustrative only. */
  label: string;
  sample: PreviewSampleContent;
}

/* ── Deterministic industry content (one table, never per-template) ──── */

interface IndustryContent {
  label: string;
  headline: string;
  subheadline: string;
  cta: string;
  quote: string;
  author: string;
  slides: string[];
  sections: Array<{ label: string; value: string }>;
}

const INDUSTRIES: readonly IndustryContent[] = [
  {
    label: 'Marketing',
    headline: 'Turn attention into pipeline', subheadline: 'Campaigns that compound, week over week', cta: 'See the playbook',
    quote: '“The brands that win make the next click obvious.”', author: '— Head of Growth',
    slides: ['The hook', 'The audience', 'The message', 'The channel', 'The proof', 'The next step'],
    sections: [{ label: '3.4x', value: 'pipeline created' }, { label: '−38%', value: 'cost per lead' }, { label: '92%', value: 'on-brand assets' }, { label: '2 wks', value: 'to launch' }],
  },
  {
    label: 'Sales',
    headline: 'Close more, chase less', subheadline: 'Put every rep on the best next move', cta: 'Book a demo',
    quote: '“Speed to lead is the whole game.”', author: '— VP Sales',
    slides: ['The deal', 'The signal', 'The pitch', 'The objection', 'The close', 'The follow-up'],
    sections: [{ label: '+27%', value: 'win rate' }, { label: '−2 days', value: 'to first touch' }, { label: '4.1x', value: 'meetings booked' }, { label: '88%', value: 'quota attainment' }],
  },
  {
    label: 'Finance',
    headline: 'Clarity on every number', subheadline: 'Close the books with confidence', cta: 'Get the report',
    quote: '“Trust is built one reconciled line at a time.”', author: '— CFO',
    slides: ['The baseline', 'The drivers', 'The risk', 'The forecast', 'The decision', 'The review'],
    sections: [{ label: '−40%', value: 'close time' }, { label: '99.9%', value: 'reconciled' }, { label: '12 hrs', value: 'saved monthly' }, { label: '0', value: 'manual errors' }],
  },
  {
    label: 'Healthcare',
    headline: 'Better care, less friction', subheadline: 'More time with patients, less with paperwork', cta: 'Learn more',
    quote: '“Every minute saved is a minute returned to care.”', author: '— Clinical Lead',
    slides: ['The intake', 'The triage', 'The plan', 'The treatment', 'The outcome', 'The follow-up'],
    sections: [{ label: '−45%', value: 'admin time' }, { label: '4.8/5', value: 'patient rating' }, { label: '+22%', value: 'capacity' }, { label: '100%', value: 'compliant' }],
  },
  {
    label: 'Education',
    headline: 'Learning that sticks', subheadline: 'Meet every learner where they are', cta: 'Start learning',
    quote: '“Understanding beats memorising, every time.”', author: '— Program Director',
    slides: ['The concept', 'The why', 'The example', 'The practice', 'The mastery', 'The recap'],
    sections: [{ label: '+31%', value: 'completion' }, { label: '4.7/5', value: 'learner rating' }, { label: '−25%', value: 'drop-off' }, { label: '3x', value: 'engagement' }],
  },
  {
    label: 'Technology',
    headline: 'Ship faster without breaking trust', subheadline: 'Automation your team actually relies on', cta: 'Explore the docs',
    quote: '“Make the right thing the easy thing.”', author: '— Staff Engineer',
    slides: ['The problem', 'The architecture', 'The build', 'The rollout', 'The result', 'What’s next'],
    sections: [{ label: '99.99%', value: 'uptime' }, { label: '−60%', value: 'incident time' }, { label: '3.2x', value: 'deploy speed' }, { label: '0', value: 'rollbacks' }],
  },
];

/** Stable, deterministic hash of a template id (rotation seed for variety). */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = ((h * 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Build an industry variant that PRESERVES the template's structure (same field
 *  set + same slide/section counts) and only swaps the content. */
function variantSample(base: PreviewSampleContent, ind: IndustryContent): PreviewSampleContent {
  const out: PreviewSampleContent = {};
  if (typeof base.quote === 'string') {
    out.quote = ind.quote;
    if (typeof base.author === 'string') out.author = ind.author;
  } else if (typeof base.headline === 'string') {
    out.headline = ind.headline;
    if (typeof base.subheadline === 'string') out.subheadline = ind.subheadline;
  }
  if (base.cta) out.cta = ind.cta;
  if (Array.isArray(base.slides)) out.slides = base.slides.map((_v, i) => ind.slides[i % ind.slides.length]);
  if (Array.isArray(base.sections)) out.sections = base.sections.map((_v, i) => ind.sections[i % ind.sections.length]);
  return out;
}

function isEmptySample(s: PreviewSampleContent): boolean {
  return !s.quote && !s.headline && !(s.slides && s.slides.length) && !(s.sections && s.sections.length);
}

/**
 * Deterministic example outcomes for a template (3–5 for system templates with
 * content; exactly 1 for user templates or empty samples).
 */
export function buildPreviewExamples(template: CreatorTemplate): PreviewExample[] {
  const sample = (template.preview?.sample ?? {}) as PreviewSampleContent & { examples?: Array<PreviewSampleContent & { label?: string }> };

  // 1) Authored examples win, verbatim.
  if (Array.isArray(sample.examples) && sample.examples.length > 0) {
    return sample.examples.map((ex, i) => ({ label: ex.label || `Example ${i + 1}`, sample: ex }));
  }

  const base: PreviewSampleContent = { ...sample };
  delete (base as { examples?: unknown }).examples;

  // 2) User templates + empty samples keep their single existing preview.
  if (template.ownership === 'user' || isEmptySample(base)) {
    return [{ label: 'Preview', sample: base }];
  }

  // 3) Derived industry examples (deterministic rotation by template id).
  const start = hashId(template.id) % INDUSTRIES.length;
  const picks = [1, 2, 3].map((k) => INDUSTRIES[(start + k) % INDUSTRIES.length]);
  return [
    { label: 'Featured', sample: base },
    ...picks.map((ind) => ({ label: ind.label, sample: variantSample(base, ind) })),
  ];
}

/* ── Side-by-side example synchronization (CREATOR-005) ──────────────── */

/** Ordered, de-duplicated union of example labels across several templates. */
export function unionExampleLabels(lists: ReadonlyArray<ReadonlyArray<PreviewExample>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) for (const e of list) if (!seen.has(e.label)) { seen.add(e.label); out.push(e.label); }
  return out;
}

/**
 * Pick the example a column should show for the synchronized selection: the one
 * matching `label` when present, otherwise the closest by index (deterministic).
 */
export function pickSyncedExample(examples: ReadonlyArray<PreviewExample>, label: string | null, idx: number): PreviewExample {
  if (label) {
    const found = examples.find((e) => e.label === label);
    if (found) return found;
  }
  return examples[Math.min(Math.max(0, idx), examples.length - 1)] ?? examples[0];
}
