/**
 * Message Generation Engine — the ONLY place AI is allowed. When NO content
 * exists (topic / idea / brief / voice transcript / prompt / notes), the
 * existing AI Gateway + Writer AI produce TEXT (via the existing intake/package
 * endpoints — no new AI pipeline), and this engine deterministically structures
 * that text into a canonical `MessageDocument`. The structuring REUSES Message
 * Extraction (which reuses Content Intelligence) — no duplicate extraction.
 * Pure: given the same generated text + brief, the MessageDocument is identical.
 */

import { extractMessageDocument } from './messageExtraction';
import type { MessageDocument } from './messageFoundation';

export interface MessageBrief {
  topic?: string;
  description?: string;
  audience?: string | null;
  platform?: string | null;
  tone?: string | null;
  objective?: string | null;
  campaignObjective?: string | null;
  keywords?: string[];
  id?: string;
}

/**
 * Structure AI-/voice-/notes-produced text into a MessageDocument. `generatedText`
 * is the output of the existing AI Gateway (or a voice transcript / manual notes
 * — all are just text to be structured deterministically here).
 */
export function generateMessageDocument(generatedText: string, brief: MessageBrief = {}): MessageDocument {
  const title = (brief.topic || brief.description || '').split('\n')[0]?.slice(0, 80) || '';
  return extractMessageDocument({
    content: generatedText,
    source: 'generation',
    id: brief.id,
    title,
    audience: brief.audience ?? null,
    platform: brief.platform ?? null,
    tone: brief.tone ?? null,
    objective: brief.campaignObjective ?? brief.objective ?? null,
    provenance: 'generation',
    metadata: { brief: { topic: brief.topic ?? null, keywords: brief.keywords ?? [] } },
  });
}
