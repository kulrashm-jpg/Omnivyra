// Brand-mention extraction from LLM answer text.
//
// Producers (the per-provider adapters) call `extractCitation()` after they
// receive a real LLM answer. Output: a `CitationMention` whose `appeared` and
// `prominence` fields are derived deterministically from the answer string —
// not synthesized.

import type { AIProviderId, AIQueryClass, CitationMention } from './providerInterfaces';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute prominence (0-1) for a single brand mention at offset `position`
 * within an answer of `totalLength` chars.
 *
 *  - Mention in the first 25% of the answer → headline citation, ~1.0
 *  - Mention in 25-50%                       → ~0.7
 *  - Mention in 50-75%                       → ~0.45
 *  - Mention in last 25%                     → ~0.25
 */
function prominenceFromPosition(position: number, totalLength: number): number {
  if (totalLength <= 0) return 0;
  const ratio = position / totalLength;
  if (ratio < 0.25) return 1.0;
  if (ratio < 0.5) return 0.7;
  if (ratio < 0.75) return 0.45;
  return 0.25;
}

/** Extract the most prominent excerpt around a mention (max 240 chars). */
function extractExcerpt(answer: string, position: number, mentionLength: number): string {
  const start = Math.max(0, position - 60);
  const end = Math.min(answer.length, position + mentionLength + 100);
  const slice = answer.slice(start, end).replace(/\s+/g, ' ').trim();
  return slice.length > 240 ? slice.slice(0, 237) + '...' : slice;
}

export function extractCitation(params: {
  provider: AIProviderId;
  query: string;
  query_class: AIQueryClass;
  answer: string;
  brandName: string;
  domain: string | null;
  observedAt: string;
}): CitationMention {
  const answer = params.answer ?? '';
  if (!answer) {
    return {
      provider: params.provider,
      query: params.query,
      query_class: params.query_class,
      appeared: false,
      prominence: 0,
      evidence_excerpt: null,
      observed_at: params.observedAt,
    };
  }

  // Build the candidate match set. We prefer brand-name matches over domain
  // matches (a brand mention is more authoritative than a bare URL drop).
  const candidates: Array<{ text: string; type: 'brand' | 'domain'; weight: number }> = [];
  if (params.brandName) {
    candidates.push({ text: params.brandName, type: 'brand', weight: 1.0 });
  }
  if (params.domain) {
    candidates.push({ text: params.domain, type: 'domain', weight: 0.6 });
    // Also try the bare domain root (without subdomain).
    const root = params.domain.replace(/^https?:\/\//i, '').split('/')[0];
    if (root && root !== params.domain) {
      candidates.push({ text: root, type: 'domain', weight: 0.55 });
    }
  }

  let best: { position: number; mentionLength: number; weight: number } | null = null;

  for (const candidate of candidates) {
    const pattern = new RegExp(`\\b${escapeRegex(candidate.text)}\\b`, 'i');
    const match = answer.match(pattern);
    if (match && typeof match.index === 'number') {
      if (!best || (match.index < best.position && candidate.weight >= best.weight)) {
        best = {
          position: match.index,
          mentionLength: candidate.text.length,
          weight: candidate.weight,
        };
      }
    }
  }

  if (!best) {
    return {
      provider: params.provider,
      query: params.query,
      query_class: params.query_class,
      appeared: false,
      prominence: 0,
      evidence_excerpt: null,
      observed_at: params.observedAt,
    };
  }

  const positionalProminence = prominenceFromPosition(best.position, answer.length);
  const prominence = Number((positionalProminence * best.weight).toFixed(2));
  return {
    provider: params.provider,
    query: params.query,
    query_class: params.query_class,
    appeared: true,
    prominence,
    evidence_excerpt: extractExcerpt(answer, best.position, best.mentionLength),
    observed_at: params.observedAt,
  };
}
