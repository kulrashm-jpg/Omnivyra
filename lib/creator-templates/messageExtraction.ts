/**
 * Message Extraction Engine — deterministic. Turns EXISTING content (Writer docs,
 * blogs, articles, guides, whitepapers, newsletters, threads, research, case
 * studies, campaign/creator-asset source content, website/PDF/DOCX extracted
 * text) into a canonical `MessageDocument`. NO AI, no rewriting, no summarization
 * AI, no regeneration, no rendering. It REUSES Content Intelligence
 * (`extractIntelligence`) — no duplicate extraction logic.
 */

import { extractIntelligence, type KnowledgeItem } from './contentIntelligence';
import type { MessageDocument, MessageSource } from './messageFoundation';

export interface ExtractionInput {
  content: string;
  source?: MessageSource;
  id?: string;
  title?: string;
  summary?: string;
  audience?: string | null;
  platform?: string | null;
  tone?: string | null;
  objective?: string | null;
  provenance?: string;
  writerDocumentId?: string | null;
  metadata?: Record<string, unknown>;
}

const texts = (items: KnowledgeItem[]): string[] => items.map((i) => i.text);
const uniq = (xs: string[]): string[] => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

/** Extract a canonical MessageDocument from existing content (deterministic). */
export function extractMessageDocument(input: ExtractionInput): MessageDocument {
  const content = (input.content || '').trim();
  const intel = extractIntelligence(content, input.id ?? 'message');
  const sentences = content.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);

  const title = input.title?.trim() || lines[0] || '';
  const mainMessage = title || sentences[0] || '';
  const summary = input.summary?.trim() || sentences.slice(0, 2).join(' ');

  const benefits = uniq(texts(intel.benefits));
  const supportingMessages = uniq([...benefits, ...sentences.slice(1, 4)]).filter((s) => s !== mainMessage).slice(0, 6);
  const supportingEvidence = uniq([...texts(intel.caseStudies), ...texts(intel.socialProof), ...texts(intel.testimonials)]);
  const examples = uniq(sentences.filter((s) => /\b(for example|e\.g\.|such as|like when)\b/i.test(s)));
  const stories = uniq(sentences.filter((s) => /\b(story|journey|once|imagine|picture this)\b/i.test(s)));
  const objections = uniq(sentences.filter((s) => /\b(but what if|concern|worried|however|skeptic|objection|isn['’]t it)\b/i.test(s)));

  return {
    id: input.id ?? `msg-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'untitled'}`,
    title, summary, mainMessage,
    supportingMessages,
    supportingEvidence,
    statistics: uniq(texts(intel.statistics)),
    quotes: uniq(texts(intel.quotes)),
    stories, examples,
    benefits,
    painPoints: uniq(texts(intel.painPoints)),
    solutions: uniq(texts(intel.solutions)),
    objections,
    ctas: uniq(texts(intel.ctas)),
    references: uniq(texts(intel.references)),
    keywords: uniq(texts(intel.keywords)),
    tone: input.tone ?? null,
    objective: input.objective ?? null,
    audience: input.audience ?? null,
    platform: input.platform ?? null,
    metadata: { ...(input.metadata ?? {}), writerDocumentId: input.writerDocumentId ?? null },
    source: input.source ?? 'extraction',
    provenance: input.provenance ?? (input.writerDocumentId ? `writer:${input.writerDocumentId}` : (input.source ?? 'extraction')),
  };
}
