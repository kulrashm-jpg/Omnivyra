/**
 * Showcase Loader (CREATOR-036). Loads externalized, non-engineer-editable
 * showcase CONTENT (content/showcases/*.json) and expands a compact authoring
 * DSL into real `ContentBlock[]` that render through the production BlockRenderer
 * (preview == published — no preview-only HTML, no second renderer).
 *
 * Content lives in JSON (localization / CMS / non-engineer ready). This module
 * holds the only logic: id generation + DSL → block expansion. Every template
 * has MULTIPLE complete examples (different subjects, identical layout) for the
 * gallery's Previous/Next navigation.
 */

import type { ContentBlock } from './blockTypes';

import classic from '../../content/showcases/classic.json';
import visualFeature from '../../content/showcases/visual-feature.json';
import comparison from '../../content/showcases/comparison.json';
import tutorial from '../../content/showcases/tutorial.json';
import magazine from '../../content/showcases/magazine.json';
import narrative from '../../content/showcases/narrative.json';
import investigative from '../../content/showcases/investigative.json';
import opinion from '../../content/showcases/opinion.json';

export interface ShowcaseMeta {
  kicker: string; title: string; subtitle: string; author: string; company: string; date: string; readMins: number;
}
export interface ShowcaseDoc { meta: ShowcaseMeta; blocks: ContentBlock[]; }

/* ── Compact authoring DSL (what JSON files contain) ───────────────────── */

type CB =
  | { t: 'h2' | 'h3'; text: string }
  | { t: 'p'; text: string }
  | { t: 'q'; text: string; source: string }
  | { t: 'c'; v: 'insight' | 'note' | 'warning'; title: string; body: string }
  | { t: 'img'; seed?: string; src?: string; alt: string; caption: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'ins'; title: string; items: string[] }
  | { t: 'sum'; body: string }
  | { t: 'div' }
  | { t: 'refs'; items: Array<[string, string]> }
  | { t: 'cols'; cols: CB[][] }
  | { t: 'faq'; items: Array<[string, string]> }
  | { t: 'code'; lang: string; code: string };

interface RawExample { meta: ShowcaseMeta; blocks: CB[]; }
interface RawFile { examples: RawExample[]; }

/* ── Image resolution: curated asset path → else reliable seeded photo ─── */

function imageUrl(b: { seed?: string; src?: string }): string {
  if (b.src) return b.src.startsWith('http') || b.src.startsWith('/') ? b.src : `/showcase-assets/${b.src}`;
  return `https://picsum.photos/seed/${encodeURIComponent(b.seed || 'editorial')}/1200/675`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── DSL → ContentBlock[] expansion ────────────────────────────────────── */

function expand(blocks: CB[], idg: () => string): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h2': case 'h3': out.push({ id: idg(), type: 'heading', level: b.t === 'h2' ? 2 : 3, text: b.text } as ContentBlock); break;
      case 'p': out.push({ id: idg(), type: 'paragraph', html: `<p>${b.text}</p>` } as ContentBlock); break;
      case 'q': out.push({ id: idg(), type: 'quote', text: b.text, source: b.source } as ContentBlock); break;
      case 'c': out.push({ id: idg(), type: 'callout', variant: b.v, title: b.title, body: b.body } as ContentBlock); break;
      case 'img': out.push({ id: idg(), type: 'image', url: imageUrl(b), alt: b.alt, caption: b.caption, attribution: b.src ? undefined : 'Photo · Picsum', attributionUrl: b.src ? undefined : 'https://picsum.photos' } as ContentBlock); break;
      case 'ul': case 'ol': { const lid = idg(); out.push({ id: lid, type: 'list', listType: b.t === 'ul' ? 'bullet' : 'numbered', items: b.items.map((text, i) => ({ id: `${lid}-i${i}`, text })) } as ContentBlock); break; }
      case 'ins': out.push({ id: idg(), type: 'key_insights', title: b.title, items: b.items } as ContentBlock); break;
      case 'sum': out.push({ id: idg(), type: 'summary', body: b.body } as ContentBlock); break;
      case 'div': out.push({ id: idg(), type: 'divider' } as ContentBlock); break;
      case 'refs': { const rid = idg(); out.push({ id: rid, type: 'references', items: b.items.map(([title, url], i) => ({ id: `${rid}-r${i}`, title, url })) } as ContentBlock); break; }
      case 'cols': { const cid = idg(); out.push({ id: cid, type: 'columns', columnCount: (b.cols.length === 3 ? 3 : 2), columns: b.cols.map((c, i) => ({ id: `${cid}-c${i}`, blocks: expand(c, idg) })) } as ContentBlock); break; }
      case 'faq': for (const [q, a] of b.items) { out.push({ id: idg(), type: 'heading', level: 3, text: q } as ContentBlock); out.push({ id: idg(), type: 'paragraph', html: `<p>${a}</p>` } as ContentBlock); } break;
      case 'code': out.push({ id: idg(), type: 'paragraph', html: `<pre><code class="language-${b.lang}">${escapeHtml(b.code)}</code></pre>` } as ContentBlock); break;
    }
  }
  return out;
}

/* ── Registry + public API ─────────────────────────────────────────────── */

const FILES: Record<string, RawFile> = {
  'Classic': classic as RawFile,
  'Visual Feature': visualFeature as RawFile,
  'Comparison': comparison as RawFile,
  'Tutorial': tutorial as RawFile,
  'Magazine': magazine as RawFile,
  'Narrative Article': narrative as RawFile,
  'Investigative Deep Dive': investigative as RawFile,
  'Opinion Piece': opinion as RawFile,
};

export const SHOWCASE_TEMPLATES = Object.keys(FILES);

export function hasTemplateShowcase(name: string | undefined | null): boolean {
  return !!name && Object.prototype.hasOwnProperty.call(FILES, name);
}

/** All curated example documents for a template (>= 3), in authored order. */
export function getTemplateShowcases(name: string | undefined | null): ShowcaseDoc[] {
  const file = (name && FILES[name]) || FILES.Classic;
  return file.examples.map((ex, i) => ({ meta: ex.meta, blocks: expand(ex.blocks, idGenFor(name || 'classic', i)) }));
}

/** One example (default first). Deterministic ids per (template, exampleIndex). */
export function getTemplateShowcase(name: string | undefined | null, index = 0): ShowcaseDoc {
  const all = getTemplateShowcases(name);
  return all[Math.min(Math.max(0, index), all.length - 1)] ?? all[0];
}

export function showcaseCount(name: string | undefined | null): number {
  return getTemplateShowcases(name).length;
}

function idGenFor(name: string, exampleIndex: number): () => string {
  const prefix = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${exampleIndex}`;
  let n = 0;
  return () => `sc-${prefix}-${n++}`;
}
