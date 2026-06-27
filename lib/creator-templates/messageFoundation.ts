/**
 * Message Foundation — the canonical convergence layer. Writer-first (extraction)
 * and Creator-first (generation) both produce ONE `MessageDocument`; from there
 * the pipeline is identical: `MessageDocument → Content Package → Intelligence →
 * Strategy → Audience Journey → Architecture → Blueprint → Template → Renderer`.
 * The ONLY difference between the two entry points is how the MessageDocument is
 * created. Pure + deterministic (the unified builder routes to extraction or
 * generation; no caller knows which path ran).
 */

import type { ContentIntakeDocument, ContentSource } from './contentIntake';
import { createPackage, addIntakeSource, type ContentPackage, type PackageSourceType } from './contentPackage';
import { extractMessageDocument, type ExtractionInput } from './messageExtraction';
import { generateMessageDocument, type MessageBrief } from './messageGeneration';

export type MessageSource = 'extraction' | 'generation' | 'writer' | 'voice' | 'ai' | 'notes' | 'website' | 'pdf' | 'docx' | 'campaign' | 'asset';

export interface MessageDocument {
  id: string;
  title: string;
  summary: string;
  mainMessage: string;
  supportingMessages: string[];
  supportingEvidence: string[];
  statistics: string[];
  quotes: string[];
  stories: string[];
  examples: string[];
  benefits: string[];
  painPoints: string[];
  solutions: string[];
  objections: string[];
  ctas: string[];
  references: string[];
  keywords: string[];
  tone: string | null;
  objective: string | null;
  audience: string | null;
  platform: string | null;
  metadata: Record<string, unknown>;
  source: MessageSource;
  provenance: string;
}

/* ── Unified entry ─────────────────────────────────────────────────────── */

export type BuildMessageInput = ExtractionInput | { generatedText: string; brief?: MessageBrief };

/**
 * The single entry point. IF existing content → Message Extraction; ELSE
 * (generated text / voice / notes / brief) → Message Generation. Returns a
 * MessageDocument; the caller never knows which path was used.
 */
export function buildMessageDocument(input: BuildMessageInput): MessageDocument {
  if ('generatedText' in input) return generateMessageDocument(input.generatedText, input.brief);
  if (input.content && input.content.trim()) return extractMessageDocument(input);
  return extractMessageDocument({ ...input, content: input.content ?? '' });
}

/* ── MessageDocument → Content Package (the only changed builder) ───────── */

const SOURCE_MAP: Record<MessageSource, { intake: ContentSource; type: PackageSourceType }> = {
  extraction: { intake: 'existing', type: 'existing' }, generation: { intake: 'ai', type: 'ai' },
  writer: { intake: 'writer', type: 'writer' }, voice: { intake: 'voice', type: 'voice' },
  ai: { intake: 'ai', type: 'ai' }, notes: { intake: 'existing', type: 'notes' },
  website: { intake: 'existing', type: 'website' }, pdf: { intake: 'existing', type: 'pdf' },
  docx: { intake: 'existing', type: 'docx' }, campaign: { intake: 'existing', type: 'campaign' },
  asset: { intake: 'existing', type: 'asset' },
};

/** Compose the canonical body the Content Package (and thus Intelligence) consumes. */
function messageBody(msg: MessageDocument): string {
  const parts = [msg.title, msg.summary, msg.mainMessage, ...msg.supportingMessages, ...msg.supportingEvidence,
    ...msg.statistics, ...msg.quotes, ...msg.benefits, ...msg.painPoints, ...msg.solutions, ...msg.examples, ...msg.objections, ...msg.ctas];
  if (msg.keywords.length) parts.push(`Keywords: ${msg.keywords.join(', ')}`);
  return Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean))).join('\n\n');
}

/** MessageDocument → ContentIntakeDocument (the authoritative source for the package). */
export function messageToIntake(msg: MessageDocument): ContentIntakeDocument {
  const map = SOURCE_MAP[msg.source];
  return {
    source: map.intake, title: msg.title, summary: msg.summary, body: messageBody(msg),
    metadata: { ...msg.metadata, messageSource: msg.source, messageId: msg.id },
    campaignGoal: msg.objective, audience: msg.audience, platform: msg.platform, tone: msg.tone,
    keywords: msg.keywords, references: msg.references,
    writerDocumentId: (msg.metadata?.writerDocumentId as string) ?? null,
  };
}

/**
 * Build a Content Package from a MessageDocument — the MessageDocument is the
 * authoritative source. The package internals are unchanged; only this builder
 * is new. Same MessageDocument → identical Package → identical downstream.
 */
export function buildPackageFromMessage(msg: MessageDocument, opts: { createdAt: string }): ContentPackage {
  const map = SOURCE_MAP[msg.source];
  return addIntakeSource(createPackage(msg.id), messageToIntake(msg), { id: `${msg.id}-src`, createdAt: opts.createdAt, origin: msg.provenance, type: map.type });
}

/* ── AI collaboration — updates ONLY the MessageDocument ───────────────── */

/**
 * Apply an AI/manual edit to a single message field, returning a new
 * MessageDocument. The caller rebuilds the package (`buildPackageFromMessage`),
 * so everything downstream re-runs. Never bypasses the MessageDocument.
 */
export function updateMessage(msg: MessageDocument, patch: Partial<MessageDocument>): MessageDocument {
  return { ...msg, ...patch };
}

/* ── Search / resolve / list (over a collection; pure) ─────────────────── */

export function listMessages(msgs: MessageDocument[]): MessageDocument[] { return [...msgs]; }
export function resolveMessage(msgs: MessageDocument[], id: string): MessageDocument | null { return msgs.find((m) => m.id === id) ?? null; }
export function searchMessages(msgs: MessageDocument[], query: string): MessageDocument[] {
  const q = query.toLowerCase().trim();
  if (!q) return [...msgs];
  return msgs.filter((m) => `${m.title} ${m.mainMessage} ${m.summary} ${m.keywords.join(' ')} ${m.benefits.join(' ')}`.toLowerCase().includes(q));
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface MessageSummary {
  mainMessage: string; supportingMessages: string[]; evidence: string[]; statistics: string[]; ctas: string[];
  audience: string | null; objective: string | null; tone: string | null; source: MessageSource;
  wordCount: number; confidence: number;
}

export function summarizeMessage(msg: MessageDocument): MessageSummary {
  const wordCount = messageBody(msg).split(/\s+/).filter(Boolean).length;
  // Deterministic completeness confidence — fraction of key fields populated.
  const fields = [msg.mainMessage, msg.summary, msg.supportingMessages.length, msg.statistics.length, msg.benefits.length, msg.ctas.length, msg.audience, msg.objective];
  const filled = fields.filter((f) => (typeof f === 'number' ? f > 0 : !!f)).length;
  return {
    mainMessage: msg.mainMessage, supportingMessages: msg.supportingMessages,
    evidence: [...msg.supportingEvidence, ...msg.references], statistics: msg.statistics, ctas: msg.ctas,
    audience: msg.audience, objective: msg.objective, tone: msg.tone, source: msg.source,
    wordCount, confidence: Math.round((filled / fields.length) * 100) / 100,
  };
}
