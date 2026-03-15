/**
 * Language Refinement Layer — Tone Engine (Production Hardened)
 * Refines AI-generated text: filler removal, tone bands, card formatting.
 * Rule-based only (no LLM). Preserves business meaning and schema.
 *
 * Guards: idempotency, tone inheritance, inspirational safety for instructional content.
 */

export type CampaignTone = 'conversational' | 'educational' | 'professional' | 'inspirational';

export type LanguageRefinementInput = {
  content: string | string[];
  card_type:
    | 'weekly_plan'
    | 'daily_slot'
    | 'master_content'
    | 'platform_variant'
    | 'repurpose_card'
    | 'strategic_theme'
    | 'general';
  campaign_tone?: CampaignTone | string;
  platform?: string;
};

export type LanguageRefinementOutput = {
  refined: string | string[];
  metadata?: {
    applied: boolean;
    method: 'rule' | 'llm';
  };
};

// ─── Idempotency marker (invisible to users; stripped before return) ─────────
const REFINEMENT_MARKER = '\u200Blanguage_refined\u200B';

function stripMarker(text: string): string {
  return text.split(REFINEMENT_MARKER).join('').trim();
}

function hasMarker(text: string): boolean {
  return text.includes(REFINEMENT_MARKER);
}

// ─── Telemetry (lightweight in-process counters; no external deps) ──────────
const telemetry = {
  runs_total: 0,
  by_card_type: {} as Record<string, number>,
  by_tone: {} as Record<string, number>,
};

function recordTelemetry(cardType: string, tone: string): void {
  telemetry.runs_total += 1;
  telemetry.by_card_type[cardType] = (telemetry.by_card_type[cardType] || 0) + 1;
  telemetry.by_tone[tone] = (telemetry.by_tone[tone] || 0) + 1;
}

// ─── Tone inheritance fallback ──────────────────────────────────────────────
function getCompanyDefaultTone(): CampaignTone {
  return 'professional';
}

const DEFAULT_TONE: CampaignTone = 'professional';

function normalizeToneInput(raw: unknown): CampaignTone {
  const s = String(raw ?? '').toLowerCase().trim();
  if (['conversational', 'educational', 'professional', 'inspirational'].includes(s)) {
    return s as CampaignTone;
  }
  return DEFAULT_TONE;
}

function resolveTone(input: LanguageRefinementInput): CampaignTone {
  const fromInput = input.campaign_tone != null && String(input.campaign_tone).trim() !== '';
  return fromInput ? normalizeToneInput(input.campaign_tone) : getCompanyDefaultTone();
}

// ─── Inspirational safety: skip expressive rewrites for instructional cards ──
function shouldSkipInspirationalTone(cardType: string): boolean {
  return cardType === 'platform_variant' || cardType === 'repurpose_card';
}

function effectiveToneForPipeline(tone: CampaignTone, cardType: string): CampaignTone {
  if (tone === 'inspirational' && shouldSkipInspirationalTone(cardType)) {
    return 'professional';
  }
  return tone;
}

// ─── 1. normalizeText ──────────────────────────────────────────────────────
function normalizeText(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

// ─── 2. removeFillerPhrases ─────────────────────────────────────────────────
const FILLER_PATTERNS = [
  /\bin many different ways\b/gi,
  /\bto be able to\b/gi,
  /\bin order to\b/gi,
  /\bfor the purpose of\b/gi,
  /\bit is important to note that\b/gi,
  /\bas a matter of fact\b/gi,
  /\bthe fact of the matter is\b/gi,
  /\bwhen it comes to\b/gi,
  /\bat the end of the day\b/gi,
  /\bwhen all is said and done\b/gi,
  /\bbasically\b/gi,
  /\bessentially\b/gi,
  /\breally\b/gi,
  /\bvery\b(?=\s+\w+\s)/gi,
  /\bquite\b(?=\s+\w)/gi,
  /\bsomewhat\b/gi,
  /\brather\b/gi,
  /\bin terms of\b/gi,
  /\bwith regard to\b/gi,
  /\bwith respect to\b/gi,
  /\bdue to the fact that\b/gi,
  /\bbecause of the fact that\b/gi,
  /\bdespite the fact that\b/gi,
  /\bthe reason why\b/gi,
  /\bhelping\s+(?:teams|users|people)\s+to\b/gi,
  /\bhelp\s+(?:teams|users|people)\s+to\s+be able to\b/gi,
];

const REDUNDANT_PHRASES: Array<[RegExp, string]> = [
  [/\bare\s+helping\b/gi, 'help'],
  [/\bin\s+many\s+different\s+ways\s+to\s+be\s+able\s+to\s+/gi, ''],
  [/\bto\s+be\s+able\s+to\s+/gi, 'to '],
  [/\bin\s+order\s+to\s+/gi, 'to '],
  [/\bfor\s+the\s+purpose\s+of\s+/gi, 'to '],
  [/\bthe\s+reason\s+why\s+is\s+that\s+/gi, ''],
  [/\bhelp\s+(\w+)\s+to\s+/gi, 'help $1 '],
];

function removeFillerPhrases(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDUNDANT_PHRASES) {
    result = result.replace(pattern, replacement);
  }
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

// ─── 3. Tone transformation functions ───────────────────────────────────────

function applyConversationalTone(text: string): string {
  let result = text;
  result = result.replace(/\bexecute\b/gi, 'run');
  result = result.replace(/\bimplement\b/gi, 'set up');
  result = result.replace(/\butilize\b/gi, 'use');
  result = result.replace(/\bfacilitate\b/gi, 'help');
  result = result.replace(/\bcommence\b/gi, 'start');
  result = result.replace(/\bwill not\b/gi, "won't");
  result = result.replace(/\bdo not\b/gi, "don't");
  result = result.replace(/\bcan not\b/gi, "can't");
  result = result.replace(/\bdoes not\b/gi, "doesn't");
  result = result.replace(/\bis not\b/gi, "isn't");
  result = result.replace(/\bit is\b/gi, "it's");
  return result;
}

function applyEducationalTone(text: string): string {
  let result = text;
  result = result.replace(/\bexecute\b/gi, 'run');
  result = result.replace(/\bfaster\b/gi, 'more efficiently');
  result = result.replace(/\butilize\b/gi, 'use');
  result = result.replace(/\bfacilitate\b/gi, 'enable');
  result = result.replace(/\bimplement\b/gi, 'set up');
  return result;
}

function applyProfessionalTone(text: string): string {
  let result = text;
  result = result.replace(/\bare\s+helping\b/gi, 'enable');
  result = result.replace(/\bhelp\s+(\w+\s+)*(teams|users|people)\b/gi, 'enable $1$2');
  result = result.replace(/\bhelp\s+(?:teams|users|people|to)\s+/gi, 'enable ');
  result = result.replace(/\bfaster\b/gi, 'more efficiently');
  result = result.replace(/\bawesome\b/gi, 'effective');
  result = result.replace(/\bgreat\b/gi, 'strong');
  result = result.replace(/\bcool\b/gi, 'suitable');
  result = result.replace(/\bstuff\b/gi, 'materials');
  result = result.replace(/\bthings\b/gi, 'elements');
  result = result.replace(/\butilize\b/gi, 'use');
  result = result.replace(/\bfacilitate\b/gi, 'enable');
  result = result.replace(/\bleverage\b/gi, 'use');
  return result;
}

function applyInspirationalTone(text: string): string {
  let result = text;
  result = result.replace(
    /\bhelp\s+(?:\w+\s+)*(teams|users|people)\s+(?:to\s+)?execute\s+campaigns\s+faster\b/gi,
    'are unlocking faster and smarter marketing execution'
  );
  result = result.replace(/\bare\s+helping\b/gi, 'are unlocking');
  result = result.replace(/\bhelp\s+(teams|users|people)\b/gi, 'empower $1');
  result = result.replace(/\benable\b/gi, 'unlock');
  result = result.replace(/\bexecute\s+campaigns\s+faster\b/gi, 'faster and smarter marketing execution');
  result = result.replace(/\bexecute\s+campaigns\b/gi, 'campaign execution');
  result = result.replace(/\bfaster\b(?!\s+and\s+smarter)/gi, 'faster and smarter');
  result = result.replace(/\bstart\b/gi, 'launch');
  result = result.replace(/\bmake\b/gi, 'create');
  return result;
}

function applyToneProfile(text: string, tone: CampaignTone): string {
  switch (tone) {
    case 'conversational':
      return applyConversationalTone(text);
    case 'educational':
      return applyEducationalTone(text);
    case 'professional':
      return applyProfessionalTone(text);
    case 'inspirational':
      return applyInspirationalTone(text);
    default:
      return applyProfessionalTone(text);
  }
}

// ─── 4. Card-type formatting ───────────────────────────────────────────────
function cardTypeFormatting(text: string, cardType: string): string {
  switch (cardType) {
    case 'weekly_plan':
    case 'strategic_theme': {
      const words = text.trim().split(/\s+/);
      if (words.length > 12) {
        const keep = words.slice(0, 12).join(' ');
        const lastPunct = keep.search(/[.,;:](?=\s*\w*$)/);
        return (lastPunct >= 0 ? keep.slice(0, lastPunct + 1) : keep).trim();
      }
      return text;
    }
    case 'daily_slot': {
      const words = text.trim().split(/\s+/);
      if (words.length > 10) {
        return words.slice(0, 10).join(' ').trim();
      }
      return text;
    }
    case 'master_content':
      return text.replace(/\n{3,}/g, '\n\n').trim();
    case 'platform_variant':
    case 'repurpose_card':
      return text.replace(/\s{2,}/g, ' ').trim();
    default:
      return text.trim();
  }
}

// ─── 5. Punctuation normalization ───────────────────────────────────────────
function punctuationNormalization(text: string, cardType: string): string {
  if (!text.trim()) return text;
  let result = text.trim();
  if (!/[.!?]$/.test(result)) result = result + '.';
  result = result.replace(/\s+/g, ' ').trim();
  if (['weekly_plan', 'strategic_theme', 'daily_slot'].includes(cardType)) {
    const smallWords = new Set([
      'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'of', 'in', 'with',
    ]);
    result = result
      .split(' ')
      .map((word, i) => {
        if (/^[A-Z]{2,}$/.test(word)) return word;
        const lower = word.toLowerCase();
        if (i > 0 && smallWords.has(lower) && word.length <= 3) return lower;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }
  return result;
}

// ─── Pipeline (idempotency check before) ────────────────────────────────────
function runRefinementPipeline(
  text: string,
  opts: { cardType: string; campaignTone: CampaignTone }
): string {
  if (!text || typeof text !== 'string') return text;
  let result = text.trim();
  if (!result) return text;

  result = normalizeText(result);
  result = removeFillerPhrases(result);
  result = result.replace(/([^.]+\.[\s]*)\1+/gi, '$1');
  result = applyToneProfile(result, opts.campaignTone);
  result = cardTypeFormatting(result, opts.cardType);
  result = punctuationNormalization(result, opts.cardType);

  return result.replace(/\s+/g, ' ').trim() || text;
}

function refineSingleString(
  text: string,
  cardType: string,
  resolvedTone: CampaignTone
): string {
  const effectiveTone = effectiveToneForPipeline(resolvedTone, cardType);
  return runRefinementPipeline(text, { cardType, campaignTone: effectiveTone });
}

export async function refineLanguageOutput(
  input: LanguageRefinementInput
): Promise<LanguageRefinementOutput> {
  const enabled = String(process.env.LANGUAGE_REFINEMENT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) {
    return {
      refined: input.content,
      metadata: { applied: false, method: 'rule' },
    };
  }

  const resolvedTone = resolveTone(input);
  const cardType = input.card_type;

  try {
    if (Array.isArray(input.content)) {
      const refined = input.content.map((item) => {
        const str = String(item ?? '');
        if (hasMarker(str)) {
          return stripMarker(str);
        }
        return refineSingleString(str, cardType, resolvedTone);
      });
      recordTelemetry(cardType, resolvedTone);
      return {
        refined,
        metadata: { applied: true, method: 'rule' },
      };
    }

    const str = String(input.content ?? '');
    if (hasMarker(str)) {
      return {
        refined: stripMarker(str),
        metadata: { applied: false, method: 'rule' },
      };
    }

    const refined = refineSingleString(str, cardType, resolvedTone);
    recordTelemetry(cardType, resolvedTone);
    return {
      refined,
      metadata: { applied: true, method: 'rule' },
    };
  } catch (err) {
    console.warn('[language-refinement] failed, returning original', {
      card_type: input.card_type,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      refined: input.content,
      metadata: { applied: false, method: 'rule' },
    };
  }
}
