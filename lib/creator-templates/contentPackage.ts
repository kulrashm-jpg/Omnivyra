/**
 * Content Package — the canonical COLLABORATION layer before the Content
 * Architecture Engine. Multiple sources (existing / writer / ai / voice /
 * website / pdf / docx / campaign / asset / notes) are assembled into ONE
 * package, deterministically merged into a single `mergedDocument`. The
 * architecture consumes ONLY that merged document — it never sees PDFs, voice,
 * writer docs, etc. Pure (no AI, no DB, no rendering; timestamps are injected so
 * the same inputs always produce the same package).
 *
 * REUSES `ContentIntakeDocument`: each source wraps one — the intake document
 * becomes a source INSIDE the package. No duplicate model.
 */

import type { ContentIntakeDocument, ContentSource } from './contentIntake';
import { intakeToArchitectureBody } from './contentIntake';
import { extractIntelligence, type ContentIntelligence } from './contentIntelligence';
import { classifyStrategy, type CommunicationStrategyResult } from './communicationStrategy';
import { classifyAudienceJourney, type AudienceJourneyResult } from './audienceJourney';

export type PackageSourceType =
  | 'notes' | 'existing' | 'writer' | 'campaign' | 'asset' | 'website' | 'pdf' | 'docx' | 'voice' | 'ai';

// Deterministic merge priority — lower wins (manual notes → … → AI).
const PRIORITY: Record<PackageSourceType, number> = {
  notes: 1, existing: 2, writer: 2, campaign: 3, asset: 3, website: 4, pdf: 5, docx: 5, voice: 6, ai: 7,
};

export interface PackageSource {
  id: string;
  type: PackageSourceType;
  title: string;
  body: string;
  summary: string;
  metadata: Record<string, unknown>;
  origin: string;
  createdAt: string;
  selected: boolean;
  priority: number;
  editable: boolean;
}

export interface PackageHistoryEntry {
  label: string;
  at: string;
  mergedDocument: ContentIntakeDocument;
  sourceCount: number;
}

export interface ContentPackage {
  id: string;
  sources: PackageSource[];
  mergedDocument: ContentIntakeDocument;
  metadata: Record<string, unknown>;
  campaignGoal: string | null;
  audience: string | null;
  platform: string | null;
  tone: string | null;
  keywords: string[];
  references: string[];
  writerDocuments: string[];
  campaignAssets: string[];
  provenance: string[];
  history: PackageHistoryEntry[];
  aiRevisions: number;
}

function emptyMerged(): ContentIntakeDocument {
  return { source: 'existing', title: '', body: '', summary: '', metadata: {}, campaignGoal: null, audience: null, platform: null, tone: null, keywords: [], references: [], writerDocumentId: null };
}

export function createPackage(id: string): ContentPackage {
  return {
    id, sources: [], mergedDocument: emptyMerged(), metadata: {},
    campaignGoal: null, audience: null, platform: null, tone: null, keywords: [], references: [],
    writerDocuments: [], campaignAssets: [], provenance: [], history: [], aiRevisions: 0,
  };
}

const TYPE_OF_INTAKE: Record<ContentSource, PackageSourceType> = { existing: 'existing', ai: 'ai', voice: 'voice', writer: 'writer' };

/** Wrap a ContentIntakeDocument as a package source (the intake doc → one source). */
export function sourceFromIntake(doc: ContentIntakeDocument, opts: { id: string; createdAt: string; origin?: string; type?: PackageSourceType; editable?: boolean }): PackageSource {
  const type = opts.type ?? TYPE_OF_INTAKE[doc.source] ?? 'existing';
  return {
    id: opts.id, type, title: doc.title, body: doc.body, summary: doc.summary,
    // Carry the intake scalar metadata so merge can resolve scalars by priority.
    metadata: { ...doc.metadata, __intake: { campaignGoal: doc.campaignGoal, audience: doc.audience, platform: doc.platform, tone: doc.tone, keywords: doc.keywords, references: doc.references, writerDocumentId: doc.writerDocumentId } },
    origin: opts.origin ?? (doc.writerDocumentId ? `writer:${doc.writerDocumentId}` : type),
    createdAt: opts.createdAt, selected: true, priority: PRIORITY[type], editable: opts.editable ?? true,
  };
}

/* ── Source ops ────────────────────────────────────────────────────────── */

function uniq(xs: string[]): string[] { return Array.from(new Set(xs.filter(Boolean))); }

/** Add a source from an intake document (the intake doc becomes one source). */
export function addIntakeSource(pkg: ContentPackage, doc: ContentIntakeDocument, opts: { id: string; createdAt: string; origin?: string; type?: PackageSourceType }): ContentPackage {
  return mergePackage({ ...pkg, sources: [...pkg.sources, sourceFromIntake(doc, opts)] });
}

export function removeSource(pkg: ContentPackage, sourceId: string): ContentPackage {
  return mergePackage({ ...pkg, sources: pkg.sources.filter((s) => s.id !== sourceId) });
}

export function setSourceSelected(pkg: ContentPackage, sourceId: string, selected: boolean): ContentPackage {
  return mergePackage({ ...pkg, sources: pkg.sources.map((s) => (s.id === sourceId ? { ...s, selected } : s)) });
}

/* ── Deterministic merge ───────────────────────────────────────────────── */

function intakeOf(s: PackageSource): { campaignGoal: string | null; audience: string | null; platform: string | null; tone: string | null; keywords: string[]; references: string[]; writerDocumentId: string | null } {
  const i = (s.metadata?.__intake ?? {}) as Record<string, unknown>;
  return {
    campaignGoal: (i.campaignGoal as string) ?? null, audience: (i.audience as string) ?? null,
    platform: (i.platform as string) ?? null, tone: (i.tone as string) ?? null,
    keywords: Array.isArray(i.keywords) ? (i.keywords as string[]) : [], references: Array.isArray(i.references) ? (i.references as string[]) : [],
    writerDocumentId: (i.writerDocumentId as string) ?? null,
  };
}

/**
 * Merge the selected sources into one canonical document. Deterministic: sort by
 * priority then createdAt then id; scalar metadata = highest-priority non-empty
 * value (never overwritten by lower priority); bodies are APPENDED with paragraph
 * de-duplication; keywords/references are unioned. Provenance is the ordered
 * list of source origins.
 */
export function mergePackage(pkg: ContentPackage): ContentPackage {
  const selected = pkg.sources.filter((s) => s.selected)
    .sort((a, b) => (a.priority - b.priority) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1));

  const seen = new Set<string>();
  const paras: string[] = [];
  let title = '', summary = '';
  let campaignGoal: string | null = null, audience: string | null = null, platform: string | null = null, tone: string | null = null;
  const keywords: string[] = [], references: string[] = [], provenance: string[] = [];
  const writerDocuments: string[] = [], campaignAssets: string[] = [];

  for (const s of selected) {
    provenance.push(s.origin);
    if (!title && s.title) title = s.title;
    if (!summary && s.summary) summary = s.summary;
    const meta = intakeOf(s);
    if (!campaignGoal && meta.campaignGoal) campaignGoal = meta.campaignGoal;
    if (!audience && meta.audience) audience = meta.audience;
    if (!platform && meta.platform) platform = meta.platform;
    if (!tone && meta.tone) tone = meta.tone;
    keywords.push(...meta.keywords);
    references.push(...meta.references);
    if (meta.writerDocumentId) writerDocuments.push(meta.writerDocumentId);
    if (s.type === 'asset') campaignAssets.push(s.origin);
    // Append body paragraphs, de-duplicated (never overwrite).
    for (const p of s.body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      paras.push(p);
    }
  }

  const topSource = selected[0]?.type;
  const mergedSource: ContentSource = topSource === 'ai' || topSource === 'voice' || topSource === 'writer' ? topSource : 'existing';
  const mergedDocument: ContentIntakeDocument = {
    source: mergedSource, title, summary, body: paras.join('\n\n'),
    metadata: { mergedFrom: selected.map((s) => ({ id: s.id, type: s.type, origin: s.origin })) },
    campaignGoal, audience, platform, tone,
    keywords: uniq(keywords), references: uniq(references), writerDocumentId: writerDocuments[0] ?? null,
  };

  return {
    ...pkg, mergedDocument, campaignGoal, audience, platform, tone,
    keywords: uniq(keywords), references: uniq(references),
    writerDocuments: uniq(writerDocuments), campaignAssets: uniq(campaignAssets), provenance,
  };
}

/** The ONE canonical text the Content Architecture Engine consumes (reuses intake). */
export function packageToArchitectureBody(pkg: ContentPackage): string {
  return intakeToArchitectureBody(pkg.mergedDocument);
}

/**
 * Content Intelligence for the package — the deterministic knowledge layer
 * BETWEEN the package and the Content Architecture. Re-runs over the merged
 * document, so it always reflects the latest package state (incl. AI edits).
 * The single extraction layer every downstream consumer reuses.
 */
export function packageIntelligence(pkg: ContentPackage): ContentIntelligence {
  return extractIntelligence(packageToArchitectureBody(pkg), pkg.id);
}

/**
 * Communication Strategy for the package — the bridge `ContentPackage → (re-run)
 * Content Intelligence → classify strategy`. Deterministic; never bypassed.
 * Sits before the Content Architecture, exposing how the content should
 * communicate (intent / goal / recommended blueprints) without changing it.
 */
export function packageCommunicationStrategy(pkg: ContentPackage): CommunicationStrategyResult {
  return classifyStrategy(packageIntelligence(pkg));
}

/**
 * Audience Journey for the package — the bridge `Package → Intelligence →
 * Communication Strategy → Audience Journey`. Deterministic, read-only; never
 * bypassed. Sits before the Content Architecture, exposing who the content
 * speaks to + where they are in their journey without changing anything.
 */
export function packageAudienceJourney(pkg: ContentPackage): AudienceJourneyResult {
  const intel = packageIntelligence(pkg);
  return classifyAudienceJourney(classifyStrategy(intel), intel);
}

/* ── History / undo / restore ──────────────────────────────────────────── */

export function recordRevision(pkg: ContentPackage, label: string, at: string): ContentPackage {
  return { ...pkg, history: [...pkg.history, { label, at, mergedDocument: pkg.mergedDocument, sourceCount: pkg.sources.length }] };
}

export function undo(pkg: ContentPackage): ContentPackage {
  if (pkg.history.length === 0) return pkg;
  const prev = pkg.history[pkg.history.length - 1]!;
  return { ...pkg, mergedDocument: prev.mergedDocument, history: pkg.history.slice(0, -1) };
}

export function restoreRevision(pkg: ContentPackage, index: number): ContentPackage {
  const entry = pkg.history[index];
  if (!entry) return pkg;
  return { ...pkg, mergedDocument: entry.mergedDocument };
}

/* ── AI collaboration (shape only — the AI call lives in the service) ───── */

export type AiPackageOp =
  | 'create_draft' | 'rewrite' | 'improve' | 'expand' | 'condense' | 'merge_sources'
  | 'extract_insights' | 'extract_statistics' | 'extract_quotes' | 'extract_ctas'
  | 'generate_faqs' | 'generate_outline' | 'generate_summary' | 'repurpose' | 'convert_tone';

/**
 * Apply an AI result to the package: records the pre-op revision, adds the AI
 * output as a high-recency source, re-merges, and increments the revision count.
 * Updates ONLY the package — never the template or rendering.
 */
export function applyAiResult(pkg: ContentPackage, op: AiPackageOp, resultText: string, opts: { id: string; at: string }): ContentPackage {
  const withHistory = recordRevision(pkg, `AI: ${op}`, opts.at);
  const aiSource: PackageSource = {
    id: opts.id, type: 'ai', title: '', body: resultText.trim(), summary: '', metadata: { aiOp: op, __intake: {} },
    origin: `ai:${op}`, createdAt: opts.at, selected: true, priority: PRIORITY.ai, editable: true,
  };
  const merged = mergePackage({ ...withHistory, sources: [...withHistory.sources, aiSource] });
  return { ...merged, aiRevisions: merged.aiRevisions + 1 };
}

/** Deterministic Content Summary for the editor. */
export function describePackage(pkg: ContentPackage): { sourceCount: number; wordCount: number; aiRevisions: number; provenance: string[]; campaignGoal: string | null } {
  const wordCount = pkg.mergedDocument.body ? pkg.mergedDocument.body.split(/\s+/).filter(Boolean).length : 0;
  return { sourceCount: pkg.sources.length, wordCount, aiRevisions: pkg.aiRevisions, provenance: pkg.provenance, campaignGoal: pkg.campaignGoal };
}
