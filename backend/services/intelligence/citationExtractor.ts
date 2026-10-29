// Brand-mention extraction from LLM answer text.
//
// Producers (the per-provider adapters) call `extractCitation()` after they
// receive a real LLM answer. Output: a `CitationMention` whose `appeared` and
// `prominence` fields are derived deterministically from the answer string —
// not synthesized.
//
// ─── D1: WHAT THIS FUNCTION IS NOT ─────────────────────────────────────────
// It reports what the answer TEXT contains. It does not, and cannot, establish
// that anything was retrieved. The probe queries name the brand, so `appeared`
// is true by construction whenever the model answers fluently — including when
// it invents the company outright. Whether an observation may be called
// `measured` is decided by `resolveProbeOutcome`, from the provider's grounding
// property and the sources it returned. Nothing here promotes an answer.

import type { AIProviderId, AIQueryClass, CitationMention } from './providerInterfaces';
import { isCitationCorroborated, normalizeIdentityDomain } from './aiVisibilityGrounding';

// P0 — token edges for mention matching (see `extractCitation`). Used with the
// `u` flag. A brand must not be glued to a letter, digit or underscore; a domain
// additionally must not be glued to a hyphen, nor continue into another label
// (`acme.com.evil.io`). A preceding `.` is allowed so subdomains still match.
const BRAND_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const BRAND_EDGE_AFTER = String.raw`(?![\p{L}\p{N}_])`;
const DOMAIN_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_-])`;
const DOMAIN_EDGE_AFTER = String.raw`(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])`;

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
  /**
   * D1 — the source URLs the PROVIDER returned for this answer. Empty for any
   * provider that does not retrieve. Carried onto the mention verbatim so the
   * state decision, and a reader, can check it.
   */
  groundedSources?: readonly string[];
  observedAt: string;
}): CitationMention {
  const answer = params.answer ?? '';
  const groundedSources = [...(params.groundedSources ?? [])];
  const citationCorroborated = isCitationCorroborated(params.domain, groundedSources);
  if (!answer) {
    return {
      provider: params.provider,
      query: params.query,
      query_class: params.query_class,
      appeared: false,
      prominence: 0,
      evidence_excerpt: null,
      grounded_sources: groundedSources,
      citation_corroborated: citationCorroborated,
      observed_at: params.observedAt,
    };
  }

  // Build the candidate match set. We prefer brand-name matches over domain
  // matches (a brand mention is more authoritative than a bare URL drop).
  //
  // P0 — MATCHING RULES (narrow fix, documented):
  //  • Brand: case-insensitive, whole-token. The edge test is "not adjacent to a
  //    letter / digit / underscore" (Unicode-aware) instead of a `\b` word boundary, which is
  //    identical for brands that start and end with a word character but used to
  //    MISS brands that end in punctuation or a non-ASCII letter ("Acme Inc.",
  //    "Yahoo!", "Café") — every such answer scored `appeared: false`.
  //    "Acmetrics" does NOT match "Acme". "Acme Corp Industries" DOES match
  //    "Acme": a word-bounded matcher cannot tell a similarly-named entity from
  //    the company — a known limitation, not a claim about which entity it is.
  //  • Domain: normalised to the bare host (scheme / `www.` / path stripped, the
  //    same normaliser as the cache identity), so a stored `https://www.acme.com/`
  //    still detects "acme.com" in prose. It must not be glued to a longer
  //    label: "evil-acme.com", "notacme.com" and "acme.com.evil.io" do NOT
  //    match; "www.acme.com" / "docs.acme.com" (true subdomains) do.
  const candidates: Array<{ text: string; type: 'brand' | 'domain'; weight: number; pattern: RegExp }> = [];
  const brandText = (params.brandName ?? '').trim();
  if (brandText) {
    candidates.push({
      text: brandText,
      type: 'brand',
      weight: 1.0,
      pattern: new RegExp(`${BRAND_EDGE_BEFORE}${escapeRegex(brandText)}${BRAND_EDGE_AFTER}`, 'iu'),
    });
  }
  const host = normalizeIdentityDomain(params.domain);
  if (host) {
    candidates.push({
      text: host,
      type: 'domain',
      weight: 0.6,
      pattern: new RegExp(`${DOMAIN_EDGE_BEFORE}${escapeRegex(host)}${DOMAIN_EDGE_AFTER}`, 'iu'),
    });
  }

  let best: { position: number; mentionLength: number; weight: number } | null = null;

  for (const candidate of candidates) {
    const pattern = candidate.pattern;
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
      grounded_sources: groundedSources,
      citation_corroborated: citationCorroborated,
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
    grounded_sources: groundedSources,
    citation_corroborated: citationCorroborated,
    observed_at: params.observedAt,
  };
}
