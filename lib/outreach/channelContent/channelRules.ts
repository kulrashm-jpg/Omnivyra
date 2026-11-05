/**
 * The profile-driven validator and formatter used by every non-social channel.
 *
 * `validateChannelContent` never throws for bad content; it returns findings.
 * `formatChannelContent` is deterministic: the same arguments always produce
 * byte-identical output. Neither reads a clock, randomness, a database or the
 * network.
 */
import { checkPlaceholders, substitutePlaceholders } from './personalization';
import { analyzeSms, countEmoji, countLinks, normalizeText, toSingleLine } from './textRules';
import type {
  ChannelContentFields,
  ChannelContentFinding,
  ChannelProfile,
  FieldRule,
  FindingSeverity,
  FormatResult,
  LimitEnforcement,
  ValidationResult,
} from './types';

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** D3: only an evidence-backed (`hard`) limit refuses; an advisory one warns. */
const severityOf = (enforcement: LimitEnforcement): FindingSeverity => (enforcement === 'hard' ? 'error' : 'warning');
const limitWord = (enforcement: LimitEnforcement): string => (enforcement === 'hard' ? 'limit' : 'recommended maximum');

function checkField(rule: FieldRule, value: string, profile: ChannelProfile): ChannelContentFinding[] {
  const findings: ChannelContentFinding[] = [];
  const f = rule.name;

  if (value.trim().length < rule.length.minCharacters) {
    if (rule.required) {
      findings.push({ code: 'required_field_missing', severity: 'error', message: `${profile.label} requires a non-empty "${f}"`, field: f });
    }
    return findings;
  }

  if (value.length > rule.length.maxCharacters) {
    findings.push({
      code: 'length_exceeded',
      severity: severityOf(rule.length.enforcement),
      message: `"${f}" is ${value.length} characters; the ${profile.label} ${limitWord(rule.length.enforcement)} is ${rule.length.maxCharacters}`,
      field: f,
    });
  }
  if (rule.singleLine && /[\r\n]/.test(value)) {
    findings.push({ code: 'line_break_not_allowed', severity: 'error', message: `"${f}" must be a single line`, field: f });
  }

  const links = countLinks(value);
  if (links > 0 && !rule.links.allowed) {
    findings.push({ code: 'links_not_allowed', severity: severityOf(rule.links.enforcement), message: `"${f}" should not contain links on ${profile.label}`, field: f });
  } else if (rule.links.maxLinks !== null && links > rule.links.maxLinks) {
    findings.push({ code: 'too_many_links', severity: severityOf(rule.links.enforcement), message: `"${f}" has ${links} links; at most ${rule.links.maxLinks} recommended`, field: f });
  }

  const emoji = countEmoji(value);
  if (emoji > 0 && !rule.emoji.allowed) {
    findings.push({ code: 'emoji_not_allowed', severity: severityOf(rule.emoji.enforcement), message: `"${f}" should not contain emoji on ${profile.label}`, field: f });
  } else if (rule.emoji.maxEmoji !== null && emoji > rule.emoji.maxEmoji) {
    findings.push({ code: 'too_many_emoji', severity: severityOf(rule.emoji.enforcement), message: `"${f}" has ${emoji} emoji; at most ${rule.emoji.maxEmoji} recommended`, field: f });
  }

  findings.push(...checkPlaceholders(value, f, profile.personalizationPermitted));

  if (profile.segments && f === 'body') {
    const sms = analyzeSms(value);
    if (sms.encoding === 'ucs2') {
      findings.push({
        code: profile.segments.encodingPolicy === 'gsm7_only' ? 'sms_encoding_not_gsm7' : 'sms_ucs2_encoding',
        severity: profile.segments.encodingPolicy === 'gsm7_only' ? 'error' : 'warning',
        message: `characters outside GSM-7 force UCS-2 (70/67 per segment): ${sms.nonGsmCharacters.join(' ')}`,
        field: f,
      });
    }
    if (sms.segments > profile.segments.maxSegments) {
      findings.push({
        code: 'sms_segments_exceeded',
        severity: severityOf(profile.segments.enforcement),
        message: `body needs ${sms.segments} ${sms.encoding.toUpperCase()} segments; at most ${profile.segments.maxSegments} ${profile.segments.enforcement === 'hard' ? 'allowed' : 'recommended'}`,
        field: f,
      });
    }
  }
  return findings;
}

/** Validate content against a profile. Never throws for bad content. */
export function validateChannelContent(profile: ChannelProfile, fields: ChannelContentFields): ValidationResult {
  const input = fields ?? {};
  const findings: ChannelContentFinding[] = [];
  const known = new Set(profile.fields.map((r) => r.name));

  for (const rule of profile.fields) {
    findings.push(...checkField(rule, asText(input[rule.name]), profile));
  }
  for (const name of Object.keys(input).sort()) {
    if (!known.has(name)) {
      findings.push({ code: 'unknown_field', severity: 'warning', message: `${profile.label} has no "${name}" field; it is ignored`, field: name });
    }
  }
  return { valid: !findings.some((x) => x.severity === 'error'), findings };
}

function dedupe(findings: ChannelContentFinding[]): ChannelContentFinding[] {
  const seen = new Set<string>();
  return findings.filter((x) => {
    const key = `${x.code}|${x.field ?? ''}|${x.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalize, substitute authorized personalization values, then validate the
 * result. Returns `content: null` when any error finding exists.
 */
export function formatChannelContent(
  profile: ChannelProfile,
  fields: ChannelContentFields,
  personalization: Readonly<Record<string, string | null | undefined>> = {},
): FormatResult {
  const input = fields ?? {};
  const values = personalization ?? {};
  const out: Record<string, string> = {};
  const used: Record<string, string> = {};
  const findings: ChannelContentFinding[] = [];

  for (const rule of profile.fields) {
    const raw = asText(input[rule.name]);
    const normalized = rule.singleLine ? toSingleLine(normalizeText(raw)) : normalizeText(raw);
    const sub = substitutePlaceholders(normalized, rule.name, values, profile.personalizationPermitted);
    findings.push(...sub.findings);
    Object.assign(used, sub.used);
    out[rule.name] = sub.text;
  }

  findings.push(...validateChannelContent(profile, { ...input, ...out }).findings);
  const all = dedupe(findings);
  if (all.some((x) => x.severity === 'error')) return { content: null, findings: all };

  const sortedUsed: Record<string, string> = {};
  for (const k of Object.keys(used).sort()) sortedUsed[k] = used[k];
  return {
    content: { channel: profile.channel, fields: out, personalizationUsed: sortedUsed },
    findings: all,
  };
}
