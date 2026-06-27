/**
 * Content Intake — the ONE canonical document every Creator content source maps
 * into, before the Content Architecture Engine (`ingestAndPopulate`). Existing
 * content, AI content, voice transcripts, and Omnivyra Writer documents all
 * normalise into a `ContentIntakeDocument`, then converge into a single
 * architecture input. Pure (no AI, no DB, no rendering): the same content
 * yields the same architecture input regardless of source — only the `source`
 * tag + preserved provenance differ.
 */

export type ContentSource = 'existing' | 'ai' | 'voice' | 'writer';

/** The canonical intake document — all four sources map into this exact shape. */
export interface ContentIntakeDocument {
  source: ContentSource;
  title: string;
  body: string;
  summary: string;
  metadata: Record<string, unknown>;
  campaignGoal: string | null;
  audience: string | null;
  platform: string | null;
  tone: string | null;
  keywords: string[];
  references: string[];
  /** Set only when the source is the Writer Library (provenance / continuity). */
  writerDocumentId: string | null;
}

const SOURCE_LABELS: Record<ContentSource, string> = {
  existing: 'Existing Content', ai: 'Create with AI', voice: 'Voice Notes', writer: 'Writer Library',
};
export function intakeSourceLabel(source: ContentSource): string { return SOURCE_LABELS[source]; }

function clean(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => clean(x)).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function base(source: ContentSource): ContentIntakeDocument {
  return { source, title: '', body: '', summary: '', metadata: {}, campaignGoal: null, audience: null, platform: null, tone: null, keywords: [], references: [], writerDocumentId: null };
}

export interface IntakeContext {
  title?: string;
  campaignGoal?: string | null;
  audience?: string | null;
  platform?: string | null;
  tone?: string | null;
  keywords?: unknown;
  references?: unknown;
}

/* ── Source → canonical document (all produce the SAME shape) ───────────── */

/** Existing written content (paste): article, notes, blog, landing page, etc. */
export function fromExistingContent(raw: string, ctx: IntakeContext = {}): ContentIntakeDocument {
  const doc = base('existing');
  doc.body = clean(raw);
  doc.title = clean(ctx.title);
  doc.campaignGoal = ctx.campaignGoal ?? null;
  doc.audience = ctx.audience ?? null;
  doc.platform = ctx.platform ?? null;
  doc.tone = ctx.tone ?? null;
  doc.keywords = strArray(ctx.keywords);
  doc.references = strArray(ctx.references);
  return doc;
}

export interface AiBrief {
  description: string;
  communicationGoal?: string | null;
  audience?: string | null;
  platform?: string | null;
  industry?: string | null;
  tone?: string | null;
  campaignObjective?: string | null;
  referenceUrl?: string | null;
  keywords?: unknown;
  callToAction?: string | null;
  lengthPreference?: string | null;
}

/** AI-generated content — the Writer AI's structured text + the brief that drove it. */
export function fromAiContent(generated: string, brief: AiBrief): ContentIntakeDocument {
  const doc = base('ai');
  doc.body = clean(generated);
  doc.title = clean(brief.description).split('\n')[0]?.slice(0, 80) ?? '';
  doc.campaignGoal = brief.campaignObjective ?? brief.communicationGoal ?? null;
  doc.audience = brief.audience ?? null;
  doc.platform = brief.platform ?? null;
  doc.tone = brief.tone ?? null;
  doc.keywords = strArray(brief.keywords);
  doc.references = brief.referenceUrl ? [clean(brief.referenceUrl)] : [];
  doc.metadata = { brief: { industry: brief.industry ?? null, callToAction: brief.callToAction ?? null, lengthPreference: brief.lengthPreference ?? null } };
  return doc;
}

/** Voice notes — transcribed canonical text. */
export function fromVoiceTranscript(transcript: string, ctx: IntakeContext = {}): ContentIntakeDocument {
  const doc = base('voice');
  doc.body = clean(transcript);
  doc.title = clean(ctx.title);
  doc.campaignGoal = ctx.campaignGoal ?? null;
  doc.audience = ctx.audience ?? null;
  doc.platform = ctx.platform ?? null;
  doc.tone = ctx.tone ?? null;
  doc.keywords = strArray(ctx.keywords);
  doc.references = strArray(ctx.references);
  return doc;
}

/** Writer-library document (blog/article/draft) — preserves ALL metadata for continuity. */
export interface WriterDocument {
  id?: string | null;
  title?: string;
  body?: string;
  content?: string;
  summary?: string;
  meta_description?: string;
  keywords?: unknown;
  target_audience?: unknown;
  audience?: unknown;
  campaign_objective?: string;
  tone?: string;
  seo?: unknown;
  seo_metadata?: unknown;
  references?: unknown;
  citations?: unknown;
  [k: string]: unknown;
}

export function fromWriterDocument(d: WriterDocument): ContentIntakeDocument {
  const doc = base('writer');
  doc.writerDocumentId = d.id != null ? String(d.id) : null;
  doc.title = clean(d.title);
  doc.body = clean(d.body) || clean(d.content);
  doc.summary = clean(d.summary) || clean(d.meta_description);
  doc.keywords = strArray(d.keywords);
  doc.audience = strArray(d.target_audience ?? d.audience)[0] ?? null;
  doc.campaignGoal = clean(d.campaign_objective) || null;
  doc.tone = clean(d.tone) || null;
  doc.references = [...strArray(d.references), ...strArray(d.citations)];
  // Preserve SEO + the full source record so Context Assembly loses nothing.
  doc.metadata = { seo: d.seo ?? d.seo_metadata ?? null, writerSource: { id: doc.writerDocumentId } };
  return doc;
}

/* ── Convergence — canonical document → Content Architecture input ──────── */

/**
 * Fold a ContentIntakeDocument into the single canonical TEXT the Content
 * Architecture Engine (`ingestAndPopulate`) consumes. Identical content →
 * identical architecture input, no matter the source. Writer metadata
 * (title/summary/keywords) is folded in so no information is lost and the
 * architecture detects headings/sections deterministically.
 */
export function intakeToArchitectureBody(doc: ContentIntakeDocument): string {
  const parts: string[] = [];
  if (doc.title) parts.push(doc.title);
  if (doc.summary && doc.summary !== doc.body) parts.push(doc.summary);
  if (doc.body) parts.push(doc.body);
  if (doc.keywords.length) parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  return parts.join('\n\n').trim();
}

/** A compact, deterministic summary of the intake for the editor "Content Summary". */
export function describeIntake(doc: ContentIntakeDocument): { source: string; title: string; wordCount: number; hasMetadata: boolean } {
  return {
    source: intakeSourceLabel(doc.source),
    title: doc.title || '(untitled)',
    wordCount: doc.body ? doc.body.split(/\s+/).filter(Boolean).length : 0,
    hasMetadata: !!(doc.campaignGoal || doc.audience || doc.platform || doc.tone || doc.keywords.length || doc.references.length),
  };
}
