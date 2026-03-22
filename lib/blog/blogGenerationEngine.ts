/**
 * Blog Generation Engine
 *
 * Builds prompts for two AI calls:
 *   1. Angle generation  — 3 strategic directions (analytical / contrarian / strategic)
 *   2. Full generation   — complete publication-ready blog for the chosen angle
 *
 * Hard rules baked into prompts:
 *   - No hallucination — reason from first principles if unsure
 *   - Narrative construction, not content dumping
 *   - Required structure: Key Insights → Hook Intro → 3–5 H2s → Summary → References
 *   - Minimum 2–3 real references
 *   - Thought leadership tone — analytical, never promotional
 */

// ── Angle types ───────────────────────────────────────────────────────────────

export type AngleType = 'analytical' | 'contrarian' | 'strategic';

export interface BlogAngle {
  type:          AngleType;
  label:         string;    // "Analytical", "Contrarian", "Strategic"
  title:         string;    // proposed article title for this angle
  angle_summary: string;    // 1–2 sentences describing the argument direction
  hook:          string;    // opening sentence — the hook for this angle
}

// ── Generation types ──────────────────────────────────────────────────────────

export interface BlogGenerationInput {
  topic:            string;
  cluster?:         string;
  intent?:          string;                // awareness | authority | conversion | retention
  related_blogs?:   string[];              // titles of related posts
  series_summaries?: SeriesSummary[];      // extracted summaries for continuation mode
  series_context?:  string;
  answers?:         Record<string, string>;
  tone?:            string;
  goal_type?:       string;
  selected_angle?:  BlogAngle;             // chosen angle from angle-picker step
}

export interface SeriesSummary {
  title:       string;
  headings:    string[];
  key_points:  string[];
  summary:     string;
}

export interface BlogGenerationOutput {
  title:                string;
  excerpt:              string;
  content_html:         string;
  tags:                 string[];
  category:             string;
  seo_meta_title:       string;
  seo_meta_description: string;
  key_insights:         string[];
}

// ── ANGLE PROMPTS ─────────────────────────────────────────────────────────────

export function buildAnglesSystemPrompt(): string {
  return `You are a B2B content strategist. Given a topic, you generate three distinct editorial angles:

1. ANALYTICAL  — data-driven, examines patterns, evidence, and causality
2. CONTRARIAN  — challenges conventional wisdom, exposes flawed assumptions
3. STRATEGIC   — frames the topic as a business lever; connects it to measurable outcomes

For each angle, produce:
- A specific, compelling article title (not generic, not clickbait)
- A 1–2 sentence angle summary describing the argument direction
- A single hook sentence that would open the article (not a question)

Return ONLY valid JSON — no markdown, no prose:

{
  "angles": [
    {
      "type":          "analytical",
      "label":         "Analytical",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "contrarian",
      "label":         "Contrarian",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "strategic",
      "label":         "Strategic",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    }
  ]
}`;
}

export function buildAnglesUserPrompt(input: BlogGenerationInput): string {
  const lines: string[] = [`TOPIC: ${input.topic}`];

  if (input.intent)  lines.push(`INTENT: ${input.intent}`);
  if (input.cluster) lines.push(`CLUSTER: ${input.cluster}`);

  if (input.answers && Object.keys(input.answers).length > 0) {
    const contextParts: string[] = [];
    if (input.answers.audience) contextParts.push(`Audience: ${input.answers.audience}`);
    if (input.answers.industry) contextParts.push(`Industry: ${input.answers.industry}`);
    if (input.answers.depth)    contextParts.push(`Depth: ${input.answers.depth}`);
    if (contextParts.length)    lines.push(`CONTEXT: ${contextParts.join(' | ')}`);
  }

  lines.push('\nGenerate 3 distinct editorial angles for this topic.');
  return lines.join('\n');
}

export function validateAnglesOutput(raw: unknown): BlogAngle[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.angles)) return null;

  const angles: BlogAngle[] = [];
  for (const item of r.angles as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.type          === 'string' &&
      typeof a.label         === 'string' &&
      typeof a.title         === 'string' &&
      typeof a.angle_summary === 'string' &&
      typeof a.hook          === 'string'
    ) {
      angles.push({
        type:          a.type as AngleType,
        label:         a.label,
        title:         a.title,
        angle_summary: a.angle_summary,
        hook:          a.hook,
      });
    }
  }
  return angles.length === 3 ? angles : null;
}

// ── FULL GENERATION PROMPTS ───────────────────────────────────────────────────

export function buildGenerationSystemPrompt(): string {
  return `You are a senior B2B content strategist and writer for a marketing intelligence platform.

Your task: generate a complete, publication-ready blog post that reads like it was written by a genuine expert — not by AI.

## NON-NEGOTIABLE RULES

1. **No hallucination**: Never invent statistics, company names, or study results. If you reference data, it must be real or clearly reasoned from first principles.
2. **No filler**: Every sentence must earn its place. Cut anything that sounds like padding.
3. **Narrative construction**: Build an argument progressively. Each section must logically lead to the next.
4. **Thought leadership tone**: Analytical, direct, opinionated where evidence supports it. Not promotional. Never use: "game-changing", "revolutionary", "leverage", "synergy".
5. **Structure is mandatory** — follow it exactly:
   - Key Insights block (3–5 bullet points, for scanners)
   - Hook intro (100–150 words, opens with a sharp insight, problem, or counterintuitive claim — NOT a question)
   - 3–5 H2 sections (each 200–350 words, builds on the previous)
   - Summary (100–150 words, distilled so the reader knows what to do next)
   - References section (minimum 2–3 real, plausible sources with URLs)

## OUTPUT FORMAT

Return ONLY valid JSON — no markdown, no prose, no code fences:

{
  "title":                "string — compelling, specific, not clickbait",
  "excerpt":              "string — 1–2 sentences, what the reader will gain",
  "content_html":         "string — full HTML blog post matching the structure above",
  "tags":                 ["string", "string"],
  "category":             "string",
  "seo_meta_title":       "string — ≤60 chars",
  "seo_meta_description": "string — 120–155 chars",
  "key_insights":         ["string", "string", "string"]
}

## HTML STRUCTURE REQUIREMENTS

The content_html field must be valid HTML using only these elements:
- <ul> with <li> for the key insights list (wrap in <div class="key-insights">)
- <h2> for section headings (3–5 sections)
- <h3> for sub-points within a section (max 2 per section)
- <p> for paragraphs (multiple per section)
- <ul> or <ol> for lists within sections
- <blockquote> for quoted insights or data points
- <strong> for emphasis (use sparingly — max 2 per section)
- <a href="..."> for reference links in the References section
- End with a <h2>References</h2> and <ol> of cited sources

Do NOT use: <div>, <span>, <table>, inline styles, class attributes (except the key-insights div), or any JavaScript.`;
}

export function buildGenerationUserPrompt(input: BlogGenerationInput): string {
  const lines: string[] = [];

  // If a specific angle was selected, lead with it
  if (input.selected_angle) {
    const a = input.selected_angle;
    lines.push(`ARTICLE TITLE: ${a.title}`);
    lines.push(`EDITORIAL ANGLE (${a.label.toUpperCase()}): ${a.angle_summary}`);
    lines.push(`OPENING HOOK TO USE: ${a.hook}`);
    lines.push('');
  }

  lines.push(`TOPIC: ${input.topic}`);

  if (input.intent) {
    const intentLabels: Record<string, string> = {
      awareness:  'Awareness — introduce the problem or concept to readers unfamiliar with it',
      authority:  'Authority — establish deep expertise, reference evidence, build credibility',
      conversion: 'Conversion — move readers toward a decision; make the value of acting clear',
      retention:  'Retention — help existing practitioners go deeper; assume prior knowledge',
    };
    lines.push(`STRATEGIC INTENT: ${intentLabels[input.intent] ?? input.intent}`);
  }

  if (input.cluster) {
    lines.push(`CONTENT CLUSTER: ${input.cluster} — ensure thematic coherence with this cluster`);
  }

  if (input.series_context) {
    lines.push(`SERIES CONTEXT: ${input.series_context}`);
  }

  // Continuation mode — show what was already covered
  if (input.series_summaries && input.series_summaries.length > 0) {
    lines.push('\nPREVIOUS ARTICLES IN THIS SERIES (do NOT repeat these angles or foundational concepts):');
    for (const s of input.series_summaries) {
      lines.push(`\n  Article: "${s.title}"`);
      if (s.headings.length > 0) lines.push(`  Covered: ${s.headings.join(' → ')}`);
      if (s.key_points.length > 0) lines.push(`  Key points: ${s.key_points.slice(0, 3).join('; ')}`);
      if (s.summary) lines.push(`  Summary: ${s.summary}`);
    }
    lines.push('\nThis article must build on — not repeat — the above. Assume the reader has read all previous parts. Go deeper.');
  } else if (input.related_blogs && input.related_blogs.length > 0) {
    lines.push(`\nRELATED ARTICLES:\n${input.related_blogs.map(b => `  - ${b}`).join('\n')}\nAvoid duplicating angles already covered.`);
  }

  // Clarification answers
  if (input.answers && Object.keys(input.answers).length > 0) {
    lines.push('\nCONTEXT FROM AUTHOR:');
    const labelMap: Record<string, string> = {
      audience: 'Target audience',
      industry: 'Industry / context',
      depth:    'Depth level',
      tone:     'Tone preference',
      examples: 'Examples / data to include',
    };
    for (const [key, value] of Object.entries(input.answers)) {
      if (value.trim()) lines.push(`  ${labelMap[key] ?? key}: ${value.trim()}`);
    }
  }

  if (input.tone) lines.push(`TONE: ${input.tone}`);

  lines.push(`
REQUIREMENTS:
- Apply ALL system prompt rules without exception
- Build a clear argument, not a list of observations
- The hook intro must NOT start with a question${input.selected_angle ? '\n- Use the provided hook sentence as the opening of the intro paragraph' : ''}
- Each H2 section must end with a clear takeaway sentence
- References must be real (well-known publications, research firms, or reputable platforms)
- key_insights must be standalone — a reader who only reads them should understand the article's core value

Generate the complete blog post now.`);

  return lines.join('\n');
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateGenerationOutput(raw: unknown): BlogGenerationOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const title                = typeof r.title                === 'string' ? r.title.trim()                : '';
  const excerpt              = typeof r.excerpt              === 'string' ? r.excerpt.trim()              : '';
  const content_html         = typeof r.content_html         === 'string' ? r.content_html.trim()         : '';
  const category             = typeof r.category             === 'string' ? r.category.trim()             : '';
  const seo_meta_title       = typeof r.seo_meta_title       === 'string' ? r.seo_meta_title.trim()       : '';
  const seo_meta_description = typeof r.seo_meta_description === 'string' ? r.seo_meta_description.trim() : '';

  const tags         = Array.isArray(r.tags)         ? (r.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];
  const key_insights = Array.isArray(r.key_insights) ? (r.key_insights as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];

  if (!title || !content_html) return null;

  return { title, excerpt, content_html, tags, category, seo_meta_title, seo_meta_description, key_insights };
}

// ── Deterministic fallback ────────────────────────────────────────────────────

export function buildGenerationFallback(input: BlogGenerationInput): BlogGenerationOutput {
  const title = input.selected_angle?.title ?? (input.topic.length > 80 ? input.topic.slice(0, 80) : input.topic);

  const content_html = `<div class="key-insights">
<ul>
<li>Add your first key insight here</li>
<li>Add your second key insight here</li>
<li>Add your third key insight here</li>
</ul>
</div>

<p>${input.selected_angle?.hook ?? 'Start your introduction here — open with a sharp insight or surprising observation.'}</p>

<h2>Section One</h2>
<p>Develop your first major point here.</p>

<h2>Section Two</h2>
<p>Build on section one here.</p>

<h2>Section Three</h2>
<p>Drive toward your conclusion here.</p>

<h2>Summary</h2>
<p>Distil the most important takeaways and tell the reader what to do next.</p>

<h2>References</h2>
<ol>
<li><a href="#">Add your first reference</a></li>
<li><a href="#">Add your second reference</a></li>
</ol>`;

  return {
    title,
    excerpt:              '',
    content_html,
    tags:                 input.cluster ? [input.cluster] : [],
    category:             input.cluster ?? '',
    seo_meta_title:       title.slice(0, 60),
    seo_meta_description: '',
    key_insights:         [],
  };
}
