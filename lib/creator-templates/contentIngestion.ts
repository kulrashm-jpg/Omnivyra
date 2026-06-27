/**
 * Intelligent Content Ingestion — deterministic, NO AI.
 *
 * Lets a user provide content ONCE (plain text / pasted article / blog /
 * product copy / notes / bullet points) and deterministically populate the
 * canonical template form (`TemplateFieldValues`) so they don't fill every
 * field by hand. The existing template-aware editor stays the single source of
 * truth — this only SEEDS it. Nothing is generated, rendered, or written into
 * renderer payloads here; population goes exclusively through `formDefinition`
 * (+ `renderingContract`/`describeTemplatePlan` for counts).
 *
 * No URL/document parser is built here — none exists canonically, and the phase
 * gates those on an existing pipeline. Plain text covers every paste-based
 * workflow (article, product page, case study, notes, bullets).
 */

import type { CreatorTemplate, TemplateField } from './types';
import type { TemplateFieldValues } from './values';
import { initTemplateValues } from './values';

/* ── Ingested content model ──────────────────────────────────────────── */

export interface IngestedStatistic {
  value: string;
  label: string;
}
export interface IngestedContent {
  title: string | null;
  headings: string[];
  paragraphs: string[];
  bullets: string[];
  statistics: IngestedStatistic[];
  quotes: string[];
}

export type UnusedKind = 'heading' | 'paragraph' | 'bullet' | 'statistic' | 'quote';
export interface UnusedContentItem {
  kind: UnusedKind;
  text: string;
}
export interface IngestionMappingEntry {
  target: string;
  count: number;
}
export interface IngestionResult {
  values: TemplateFieldValues;
  imported: { headings: number; paragraphs: number; bullets: number; statistics: number; quotes: number };
  mappedTo: IngestionMappingEntry[];
  unused: UnusedContentItem[];
}

/* ── Deterministic plain-text segmentation ───────────────────────────── */

const BULLET_RE = /^\s*([-*•‣◦]|\d+[.)])\s+/;
const HEADING_MD_RE = /^#{1,6}\s+/;
const QUOTE_LEAD_RE = /^["“”'‘’]/;
const QUOTE_SPAN_RE = /["“”'‘’]([^"“”'‘’]+)["“”'‘’]/;
const BLOCKQUOTE_RE = /^>\s+/;
// Leading numeric / metric token → treat the line as a statistic.
const STAT_LEAD_RE = /^[−+\-]?\$?\d[\d.,]*\s*(%|x|×|k|m|bn|\+)?\b/i;
const CTA_HINT_RE = /^(learn more|get started|getting started|sign up|signup|book (a )?(demo|call)|try (it )?(free|now)|contact( us)?|download|subscribe|start (free|now|today)|get (the|your|started)|see (the|how|more)|join( us)?|shop now|order now|request (a )?(demo|quote)|read more|explore|discover)\b/i;

function splitStatistic(line: string): IngestedStatistic {
  const m = line.match(/^([−+\-]?\$?\d[\d.,]*\s*(?:%|x|×|k|m|bn|\+)?)\s*[—–:-]?\s*(.*)$/i);
  if (m) return { value: m[1].trim(), label: m[2].trim() };
  return { value: line.trim(), label: '' };
}

function classifyShortLine(line: string, out: IngestedContent): void {
  if (STAT_LEAD_RE.test(line) && line.length < 90) out.statistics.push(splitStatistic(line));
  else out.bullets.push(line);
}

/**
 * Segment raw text into structured content. Deterministic and order-preserving:
 * markdown headings/blockquotes are honoured; bullets and numeric lines are
 * detected; short title-like lines become headings; everything else is a
 * paragraph.
 */
export function ingestContent(raw: string): IngestedContent {
  const out: IngestedContent = { title: null, headings: [], paragraphs: [], bullets: [], statistics: [], quotes: [] };
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return out;

  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

    // Mostly-bullets block → classify each line as bullet or statistic.
    const bulletCount = lines.filter((l) => BULLET_RE.test(l)).length;
    if (bulletCount > 0 && bulletCount >= Math.ceil(lines.length / 2)) {
      for (const l of lines) classifyShortLine(l.replace(BULLET_RE, '').trim(), out);
      continue;
    }

    // Multi-line block of numeric lines → statistics (e.g. a stats list with no
    // blank lines between rows).
    const statCount = lines.filter((l) => STAT_LEAD_RE.test(l) && l.length < 90).length;
    if (lines.length > 1 && statCount >= Math.ceil(lines.length / 2)) {
      for (const l of lines) {
        if (STAT_LEAD_RE.test(l) && l.length < 90) out.statistics.push(splitStatistic(l));
        else out.paragraphs.push(l);
      }
      continue;
    }

    const single = lines.length === 1 ? lines[0] : null;

    // Markdown heading.
    if (single && HEADING_MD_RE.test(single)) {
      const h = single.replace(HEADING_MD_RE, '').trim();
      if (!out.title) out.title = h; else out.headings.push(h);
      continue;
    }
    // Blockquote, or a line that opens with a quote char (with optional trailing
    // attribution) → extract the quoted span.
    if (single && (BLOCKQUOTE_RE.test(single) || (QUOTE_LEAD_RE.test(single) && QUOTE_SPAN_RE.test(single)))) {
      const span = single.match(QUOTE_SPAN_RE);
      out.quotes.push(span ? span[1].trim() : single.replace(BLOCKQUOTE_RE, '').trim());
      continue;
    }
    // Leading-number line → statistic.
    if (single && STAT_LEAD_RE.test(single) && single.length < 90) {
      out.statistics.push(splitStatistic(single));
      continue;
    }
    // Short, punctuation-light single line → heading (first becomes the title).
    if (single && single.length < 70 && single.split(/\s+/).length <= 10 && !/[.!?]$/.test(single)) {
      if (!out.title) out.title = single; else out.headings.push(single);
      continue;
    }
    // Multi-line block whose first line is a short heading → heading + paragraph.
    if (lines.length > 1 && lines[0].length < 70 && !/[.!?]$/.test(lines[0]) && lines[0].split(/\s+/).length <= 10) {
      if (!out.title) out.title = lines[0]; else out.headings.push(lines[0]);
      out.paragraphs.push(lines.slice(1).join(' ').trim());
      continue;
    }
    // Default: a paragraph (newlines folded to spaces).
    out.paragraphs.push(lines.join(' ').trim());
  }
  return out;
}

/* ── Field classification (generic, key-driven — NOT template-specific) ── */

export type FieldClass = 'title' | 'body' | 'quote' | 'author' | 'cta' | 'value' | 'other';

const TITLE_KEYS = ['headline', 'title', 'hook', 'heading', 'header', 'step', 'milestone', 'label'];
const BODY_KEYS = ['subheadline', 'subheading', 'supportingtext', 'body', 'description', 'desc', 'summary', 'text', 'caption', 'content', 'detail', 'subtitle'];
const QUOTE_KEYS = ['quote'];
const AUTHOR_KEYS = ['author', 'attribution', 'source', 'byline', 'name'];
const CTA_KEYS = ['cta', 'button', 'action', 'calltoaction'];
const VALUE_KEYS = ['value', 'metric', 'number', 'statistic', 'stat', 'figure', 'percent', 'amount', 'count'];

function norm(key: string): string {
  return String(key || '').toLowerCase().replace(/[_\s-]/g, '');
}
export function fieldClass(key: string): FieldClass {
  const k = norm(key);
  // value/cta/quote/author are most specific → check first.
  if (VALUE_KEYS.some((x) => k === x || k.includes(x))) return 'value';
  if (CTA_KEYS.some((x) => k === x || k.includes(x))) return 'cta';
  if (QUOTE_KEYS.some((x) => k === x || k.includes(x))) return 'quote';
  if (AUTHOR_KEYS.some((x) => k === x || k.includes(x))) return 'author';
  if (BODY_KEYS.some((x) => k === x || k.includes(x))) return 'body';
  if (TITLE_KEYS.some((x) => k === x || k.includes(x))) return 'title';
  return 'other';
}

/* ── Population ──────────────────────────────────────────────────────── */

function emptyRow(fields: readonly TemplateField[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const f of fields) row[f.key] = '';
  return row;
}
function pushMapped(mapped: IngestionMappingEntry[], target: string, count: number): void {
  if (count > 0) mapped.push({ target, count });
}

/**
 * Deterministically populate a template's canonical form values from ingested
 * content. Distribution is family-aware but driven entirely by `formDefinition`
 * (field keys + slide/section counts) — there is NO per-template branching.
 * Returns the populated values, an import summary, what content mapped where,
 * and any content that didn't fit (never discarded).
 */
export function populateTemplateFromContent(template: CreatorTemplate, ingested: IngestedContent): IngestionResult {
  const values = initTemplateValues(template);
  const fd = template.formDefinition;
  const mapped: IngestionMappingEntry[] = [];

  // Mutable content pools, consumed in declared field order.
  const titles = [...(ingested.title ? [ingested.title] : []), ...ingested.headings];
  const bodies = [...ingested.paragraphs];
  const bullets = [...ingested.bullets];
  const stats = [...ingested.statistics];
  const quotes = [...ingested.quotes];

  const joinBullets = (n: number): string => {
    if (!bullets.length) return '';
    const take = bullets.splice(0, n);
    return take.join('. ');
  };
  const takeTitle = (): string => titles.shift() ?? '';
  const takeBody = (): string => bodies.shift() ?? joinBullets(2);
  const takeQuote = (): string => quotes.shift() ?? bodies.shift() ?? '';

  const hasCtaField = fd.fields.some((f) => fieldClass(f.key) === 'cta');
  const pickCta = (): string => {
    // A short CTA-like line can land in any short-text pool (titles/bullets/bodies).
    for (const arr of [titles, bullets, bodies]) {
      const idx = arr.findIndex((s) => CTA_HINT_RE.test(s) && s.length < 64);
      if (idx >= 0) { const [v] = arr.splice(idx, 1); return v; }
    }
    return '';
  };
  const cta = hasCtaField ? pickCta() : '';

  // 1) Flat fields (image / banner text, shared CTA, infographic title …).
  for (const f of fd.fields) {
    const cls = fieldClass(f.key);
    let v = '';
    if (cls === 'title') v = takeTitle();
    else if (cls === 'body') v = takeBody();
    else if (cls === 'quote') v = takeQuote();
    else if (cls === 'cta') v = cta;
    else if (cls === 'value' && stats.length) v = (stats.shift() as IngestedStatistic).value;
    if (v) {
      values.fields[f.key] = v;
      pushMapped(mapped, cls === 'cta' ? 'CTA' : f.label, 1);
    }
  }

  // 2) Slides (carousel) — title from headings, body from paragraphs/bullets.
  if (fd.slides && values.slides) {
    let filled = 0;
    for (const row of values.slides) {
      let rowFilled = false;
      for (const f of fd.slides.fields) {
        const cls = fieldClass(f.key);
        let v = '';
        if (cls === 'title') v = takeTitle();
        else if (cls === 'body') v = takeBody();
        else if (cls === 'quote') v = takeQuote();
        if (v) { row[f.key] = v; rowFilled = true; }
      }
      if (rowFilled) filled += 1;
    }
    pushMapped(mapped, `${filled} slide${filled === 1 ? '' : 's'}`, filled);
  }

  // 3) Sections (infographic) — statistics consumed as value+label units;
  //    grow up to the contract's max to absorb more content.
  if (fd.sections && values.sections) {
    const desired = Math.min(fd.sections.max, Math.max(fd.sections.min, stats.length || titles.length || fd.sections.min));
    while (values.sections.length < desired) values.sections.push(emptyRow(fd.sections.fields));

    const valueField = fd.sections.fields.find((f) => fieldClass(f.key) === 'value') ?? null;
    const textFields = fd.sections.fields.filter((f) => f !== valueField);
    let filled = 0;
    let statsPlaced = 0;
    for (const row of values.sections) {
      let rowFilled = false;
      if (valueField && stats.length) {
        const s = stats.shift() as IngestedStatistic;
        row[valueField.key] = s.value;
        statsPlaced += 1;
        let usedLabel = false;
        if (textFields[0]) { row[textFields[0].key] = s.label || takeBody(); usedLabel = true; }
        for (let i = usedLabel ? 1 : 0; i < textFields.length; i += 1) {
          const v = takeBody(); if (v) row[textFields[i].key] = v;
        }
        rowFilled = true;
      } else {
        for (const f of fd.sections.fields) {
          const cls = fieldClass(f.key);
          let v = '';
          if (cls === 'title') v = takeTitle();
          else if (cls !== 'value') v = takeBody();
          if (v) { row[f.key] = v; rowFilled = true; }
        }
      }
      if (rowFilled) filled += 1;
    }
    pushMapped(mapped, `${statsPlaced} statistic${statsPlaced === 1 ? '' : 's'}`, statsPlaced);
    pushMapped(mapped, `${filled} section${filled === 1 ? '' : 's'}`, filled);
  }

  const unused: UnusedContentItem[] = [
    ...titles.map((t) => ({ kind: 'heading' as const, text: t })),
    ...bodies.map((t) => ({ kind: 'paragraph' as const, text: t })),
    ...bullets.map((t) => ({ kind: 'bullet' as const, text: t })),
    ...stats.map((s) => ({ kind: 'statistic' as const, text: `${s.value} ${s.label}`.trim() })),
    ...quotes.map((t) => ({ kind: 'quote' as const, text: t })),
  ];

  return {
    values,
    imported: {
      headings: ingested.headings.length,
      paragraphs: ingested.paragraphs.length,
      bullets: ingested.bullets.length,
      statistics: ingested.statistics.length,
      quotes: ingested.quotes.length,
    },
    mappedTo: mapped,
    unused,
  };
}

/** Convenience: ingest raw text then populate a template in one deterministic step. */
export function ingestAndPopulate(template: CreatorTemplate, raw: string): IngestionResult {
  return populateTemplateFromContent(template, ingestContent(raw));
}

/** sessionStorage key for handing populated values to the template editor. */
export function creatorIngestPrefillKey(token: string): string {
  return `creator_ingest_values_${String(token || '').trim()}`;
}
