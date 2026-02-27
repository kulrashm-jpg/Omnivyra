import { getPlatformRules, getPostingRequirements } from './platformIntelligenceService';

export type ValidationStatus = 'valid' | 'adjusted' | 'invalid';

export type PlatformRequirementsBundle = {
  max_characters: number | null;
  max_words: number | null;
  required_fields: string[];
  formatting_rules: any;
};

export type ExecutionIntelligenceDailyItem = Record<string, any> & {
  platform: string;
  contentType: string;
  /**
   * Optional draft text to validate/auto-adjust when present.
   * Daily-plan skeleton generation may not include this yet.
   */
  draftContent?: string;
  metadata?: Record<string, any>;
  platform_requirements?: PlatformRequirementsBundle;
  validation_status?: ValidationStatus;
  validation_notes?: string[];
};

function normalizePlatformKey(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'twitter') return 'x';
  return p;
}

function normalizeContentType(contentType: string): string {
  return String(contentType || '').trim().toLowerCase();
}

function getTypeMap(bundle: any): Record<string, string> | null {
  const rules = bundle?.content_rules || [];
  for (const rule of rules) {
    const candidate = rule?.formatting_rules?.type_map;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, string>;
    }
  }
  return null;
}

function splitWords(s: string): string[] {
  return String(s || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}

function truncateToWords(s: string, maxWords: number): string {
  if (!Number.isFinite(maxWords) || maxWords <= 0) return s;
  const words = splitWords(s);
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(' ');
}

function truncateToChars(s: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return s;
  const str = String(s || '');
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars);
}

async function resolvePlatformRule(input: { platform: string; contentType: string }): Promise<{
  canonical_platform: string;
  resolved_content_type: string | null;
  rule: any | null;
  formatting_rules: any;
  required_fields: string[];
}> {
  const platformKey = normalizePlatformKey(input.platform);
  const bundle = await getPlatformRules(platformKey);
  if (!bundle) {
    return {
      canonical_platform: platformKey,
      resolved_content_type: null,
      rule: null,
      formatting_rules: null,
      required_fields: [],
    };
  }

  const supported = new Set(
    (bundle.content_rules || [])
      .map((r: any) => String(r?.content_type || '').toLowerCase().trim())
      .filter(Boolean)
  );

  const normalizedType = normalizeContentType(input.contentType || 'post') || 'post';
  let resolved: string | null = supported.has(normalizedType) ? normalizedType : null;

  if (!resolved) {
    const typeMap = getTypeMap(bundle);
    const mapped = typeMap ? String(typeMap[normalizedType] || '').toLowerCase().trim() : '';
    if (mapped && supported.has(mapped)) resolved = mapped;
  }

  const rule =
    resolved != null
      ? (bundle.content_rules || []).find(
          (r: any) => String(r?.content_type || '').toLowerCase().trim() === resolved
        ) ?? null
      : null;

  const req = resolved ? await getPostingRequirements(platformKey, resolved) : { required_fields: [] as string[] };

  return {
    canonical_platform: String(bundle.platform?.canonical_key || platformKey).toLowerCase().trim() || platformKey,
    resolved_content_type: resolved,
    rule,
    formatting_rules: rule?.formatting_rules ?? null,
    required_fields: Array.isArray((req as any).required_fields) ? (req as any).required_fields : [],
  };
}

export async function validateDailyItemAgainstPlatformRules(
  dailyItem: ExecutionIntelligenceDailyItem
): Promise<{
  dailyItem: ExecutionIntelligenceDailyItem;
  validation_status: ValidationStatus;
  validation_notes: string[];
  resolved_content_type: string | null;
}> {
  const notes: string[] = [];
  let status: ValidationStatus = 'valid';

  const resolved = await resolvePlatformRule({
    platform: dailyItem.platform,
    contentType: dailyItem.contentType,
  });

  const normalizedInputType = normalizeContentType(dailyItem.contentType || 'post') || 'post';

  const out: ExecutionIntelligenceDailyItem = {
    ...dailyItem,
    platform: normalizePlatformKey(dailyItem.platform),
    contentType: resolved.resolved_content_type || normalizedInputType,
    metadata: dailyItem.metadata && typeof dailyItem.metadata === 'object' ? dailyItem.metadata : {},
  };

  if (!resolved.resolved_content_type) {
    status = 'invalid';
    notes.push(`Unsupported contentType "${normalizedInputType}" for platform "${resolved.canonical_platform}"`);
  } else if (resolved.resolved_content_type !== normalizedInputType) {
    status = 'adjusted';
    notes.push(`Mapped contentType "${normalizedInputType}" -> "${resolved.resolved_content_type}" for platform`);
  }

  if (resolved.rule) {
    const maxChars =
      resolved.rule.max_characters != null && Number.isFinite(Number(resolved.rule.max_characters))
        ? Number(resolved.rule.max_characters)
        : null;
    const maxWords =
      resolved.rule.max_words != null && Number.isFinite(Number(resolved.rule.max_words))
        ? Number(resolved.rule.max_words)
        : null;

    if (typeof out.draftContent === 'string' && out.draftContent.length > 0) {
      if (maxWords && splitWords(out.draftContent).length > maxWords) {
        out.draftContent = truncateToWords(out.draftContent, maxWords);
        status = status === 'invalid' ? 'invalid' : 'adjusted';
        notes.push(`Auto-trimmed draftContent to max_words=${maxWords}`);
      }
      if (maxChars && out.draftContent.length > maxChars) {
        out.draftContent = truncateToChars(out.draftContent, maxChars);
        status = status === 'invalid' ? 'invalid' : 'adjusted';
        notes.push(`Auto-trimmed draftContent to max_characters=${maxChars}`);
      }
    } else {
      notes.push('No draftContent provided; character/word limit adjustment skipped');
    }
  }

  const required = (resolved.required_fields || []).map((f) => String(f || '').trim()).filter(Boolean);
  for (const field of required) {
    if (Object.prototype.hasOwnProperty.call(out.metadata!, field) && out.metadata![field] != null) continue;

    if (field === 'cta' && typeof (out as any).desiredAction === 'string' && (out as any).desiredAction.trim()) {
      out.metadata![field] = String((out as any).desiredAction).trim();
      status = status === 'invalid' ? 'invalid' : 'adjusted';
      notes.push('Filled required field "cta" from desiredAction');
      continue;
    }

    out.metadata![field] = `TODO: provide ${field}`;
    status = status === 'invalid' ? 'invalid' : 'adjusted';
    notes.push(`Added placeholder for required field "${field}"`);
  }

  out.validation_status = status;
  out.validation_notes = notes;

  return { dailyItem: out, validation_status: status, validation_notes: notes, resolved_content_type: resolved.resolved_content_type };
}

export async function enrichDailyItemWithPlatformRequirements(
  dailyItem: ExecutionIntelligenceDailyItem
): Promise<ExecutionIntelligenceDailyItem> {
  const resolved = await resolvePlatformRule({
    platform: dailyItem.platform,
    contentType: dailyItem.contentType,
  });

  const max_characters =
    resolved.rule?.max_characters != null && Number.isFinite(Number(resolved.rule.max_characters))
      ? Number(resolved.rule.max_characters)
      : null;
  const max_words =
    resolved.rule?.max_words != null && Number.isFinite(Number(resolved.rule.max_words))
      ? Number(resolved.rule.max_words)
      : null;

  const required_fields = (resolved.required_fields || []).map((f) => String(f || '').trim()).filter(Boolean);

  return {
    ...dailyItem,
    platform_requirements: {
      max_characters,
      max_words,
      required_fields,
      formatting_rules: resolved.formatting_rules ?? null,
    },
  };
}

