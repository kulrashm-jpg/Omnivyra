/**
 * Personalization guard for the channel-content layer.
 *
 * The allow-list is the existing 041-D `PERSONALIZATION_FIELDS`, IMPORTED from
 * the deterministic email generator. It is never copied here: a second list
 * would drift. The placeholder syntax (`{{field}}`, case-insensitive field name)
 * matches that generator so the two agree on what a placeholder is.
 *
 * Values arrive as arguments. This module never looks a person up.
 */
import { PERSONALIZATION_FIELDS } from '../../../backend/services/emailEngine/emailContentGenerator';
import type { ChannelContentFinding } from './types';

export { PERSONALIZATION_FIELDS };

const ALLOWED: ReadonlySet<string> = new Set<string>(PERSONALIZATION_FIELDS);

/** Any `{{ ... }}`. Broader than the generator's pattern so malformed names are caught, not ignored. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface PlaceholderRef {
  readonly raw: string;
  readonly field: string;
}

export function findPlaceholders(text: string): PlaceholderRef[] {
  const out: PlaceholderRef[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    out.push({ raw: m[0], field: m[1].trim().toLowerCase() });
  }
  return out;
}

export function isAuthorizedPersonalizationField(field: string): boolean {
  return ALLOWED.has(field.trim().toLowerCase());
}

/**
 * Findings for the placeholders in one field. With personalization not
 * permitted on the channel, ANY placeholder is an error; otherwise only fields
 * outside the allow-list are.
 */
export function checkPlaceholders(
  text: string,
  fieldName: string,
  personalizationPermitted: boolean,
): ChannelContentFinding[] {
  const findings: ChannelContentFinding[] = [];
  for (const ref of findPlaceholders(text)) {
    if (!personalizationPermitted) {
      findings.push({
        code: 'personalization_not_permitted',
        severity: 'error',
        message: `this channel does not permit personalization, but "${ref.raw}" was found`,
        field: fieldName,
      });
    } else if (!ALLOWED.has(ref.field)) {
      findings.push({
        code: 'personalization_unauthorized',
        severity: 'error',
        message: `"${ref.field}" is not an authorized personalization field`,
        field: fieldName,
      });
    }
  }
  return findings;
}

const nonBlank = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/**
 * Substitute authorized placeholders with the supplied values. Unauthorized or
 * missing values produce error findings and leave the placeholder in place;
 * never an empty string, so "Hi ," cannot be produced.
 */
export function substitutePlaceholders(
  text: string,
  fieldName: string,
  values: Readonly<Record<string, string | null | undefined>>,
  personalizationPermitted: boolean,
): { text: string; used: Record<string, string>; findings: ChannelContentFinding[] } {
  const findings = checkPlaceholders(text, fieldName, personalizationPermitted);
  const used: Record<string, string> = {};
  if (findings.length > 0) return { text, used, findings };

  const result = text.replace(PLACEHOLDER, (whole, raw: string) => {
    const field = raw.trim().toLowerCase();
    const value = nonBlank(values[field]);
    if (value === null) {
      findings.push({
        code: 'personalization_missing',
        severity: 'error',
        message: `no value was supplied for "${field}"; refusing rather than leaving a gap`,
        field: fieldName,
      });
      return whole;
    }
    used[field] = value;
    return value;
  });
  return { text: result, used, findings };
}
