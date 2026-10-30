/**
 * Repository-backed export rows + serializers (CSV + Excel SpreadsheetML).
 *
 * Pure: a unified `CanonicalLeadView` (+ optional enrichments) → one flat export
 * row, then to CSV or Excel-openable XML. No source-specific logic, no dependency.
 */

import type { CanonicalLeadView } from './types';
import { recommendNextAction, summarizeLead } from './recommendations';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const firstStr = (...vals: unknown[]): string => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
};

/**
 * The PROSPECT's company, from the source's own fields only. Never the tenant
 * (`organizationId` is the company that OWNS the lead — the previous fallback
 * printed the tenant's own id as the prospect's company) and never the email
 * domain (that would leak part of a withheld endpoint).
 */
export function prospectCompanyName(view: CanonicalLeadView): string {
  const meta = obj(view.attribution.sourceMetadata);
  return firstStr(
    meta.company_name, meta.company, meta.account_name,
    obj(meta.metadata).company_name, obj(meta.lead_metadata).company_name, obj(meta.lead_metadata).account_name,
    // Account-only canonical prospect: the account resolved from its originating
    // source record (`source_records.account_id` → `prospect_accounts`).
    view.account?.name, view.account?.domain,
  );
}

/**
 * A provenance URL safe to put in a file: http(s) only, no credentials, no query
 * string or fragment (tracking tokens, emails in parameters), and nothing that
 * still carries an `@` (mailto-like or user@host paths). Anything else → ''.
 */
export function sanitizeSourceUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  let u: URL;
  try { u = new URL(raw); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  if (u.username || u.password) return '';
  const out = `${u.protocol}//${u.host}${u.pathname}`;
  return out.includes('@') ? '' : out;
}

export interface LeadExportRow {
  identity: string;
  company: string;
  source: string;
  campaign: string;
  journey: string;
  timeline_summary: string;
  buying_intent: string;
  content_interests: string;
  recommended_next_action: string;
  ai_summary: string;
  status: string;
  metadata: string;
  // ── Provenance (appended so existing column positions are unchanged) ──────
  /** `source_category` of the originating contribution (or the row-level origin hint). */
  origin_category: string;
  origin_platform: string;
  /** When the originating source observed the prospect (source time, not ingestion). */
  origin_observed_at: string;
  /** Sanitised evidence URL of the originating contribution; governed like the raw payload. */
  origin_source_url: string;
  /** Every contribution: `role:category[/platform]@observedAt`, `; `-separated. No ids, URLs or payload. */
  contributors: string;
  /** loaded | unavailable | not_applicable — `unavailable` means "not readable", not "none". */
  provenance_status: string;
  /**
   * Records of the SAME signal folded into this lead (signal merge):
   * `<source label>@<occurredAt>`, `; `-separated. Labels and times only — no
   * ids, keys, URLs, identity or payload of the linked record.
   */
  linked_sources: string;
}

/**
 * W0-B — what this row is permitted to disclose.
 *
 * Passed in by the caller, which is the only layer that may perform I/O. The
 * parameter is OPTIONAL and its absence means DENY, not allow: a caller that
 * forgets it gets a redacted row rather than a leak. That is the whole point of
 * defaulting this way round.
 */
export interface ExportDisclosure {
  /** May the email endpoint be disclosed? */
  readonly email: boolean;
  /** May the phone endpoint be disclosed? */
  readonly phone: boolean;
  /** May an ACTIONABLE recommendation be disclosed? */
  readonly action: boolean;
  /**
   * May the provenance evidence URL be disclosed? OPTIONAL and absent ⇒ DENY,
   * like the rest of this type. A source URL points at the person's own post /
   * profile, so it is personal data: the read service grants it only when
   * governance is readable, every present endpoint is permitted and no
   * all-channel restriction applies to the person.
   */
  readonly sourceUrl?: boolean;
}

/** Fail-closed default: discloses no endpoint and no action. */
export const DISCLOSE_NOTHING: ExportDisclosure = { email: false, phone: false, action: false };

/** What a reader sees instead of a withheld value. */
export const EXPORT_WITHHELD = '[withheld: contact governance]';

const s = (v: unknown): string => (v == null ? '' : String(v));
const intentOf = (v: CanonicalLeadView): number | null => v.scores.intent ?? v.scores.total ?? null;
/** closure C: an unscored lead exports as "not scored", never "0%". */
export const EXPORT_NOT_SCORED = 'not scored';
const intentLabel = (v: CanonicalLeadView): string => {
  const i = intentOf(v);
  return i === null ? EXPORT_NOT_SCORED : `${Math.round(i * 100)}%`;
};

export function toExportRow(
  view: CanonicalLeadView,
  extras?: { timelineSummary?: string; contentInterests?: string[] },
  disclosure: ExportDisclosure = DISCLOSE_NOTHING,
): LeadExportRow {
  const meta = view.attribution.sourceMetadata ?? {};
  // W0-B. An endpoint is disclosed only if governance permits THAT endpoint's
  // channel. A withheld endpoint does not fall through to the next one — the
  // non-endpoint identifiers (`platform`, `unifiedPersonId`) are not contact
  // points, so they remain available and the row stays useful.
  // True when at least one contact endpoint may be disclosed. A lead with no
  // endpoint at all is not withheld on this basis — there is nothing to leak.
  const anyEndpoint = (disclosure.email && !!view.identity.email)
    || (disclosure.phone && !!view.identity.phone)
    || !(view.identity.email || view.identity.phone);
  const endpoint = disclosure.email && view.identity.email ? view.identity.email
    : disclosure.phone && view.identity.phone ? view.identity.phone
      : (view.identity.email || view.identity.phone) ? EXPORT_WITHHELD
        : (view.identity.platform ?? view.unifiedPersonId);
  return {
    identity: s(endpoint),
    company: prospectCompanyName(view),
    source: s(view.sourceLabel),
    campaign: s(view.campaign),
    journey: s(view.attribution.originalSource ? `${view.attribution.originalSource} → ${view.source}` : view.source),
    timeline_summary: s(extras?.timelineSummary ?? view.occurredAt),
    buying_intent: intentLabel(view),
    content_interests: s((extras?.contentInterests ?? []).join('; ') || view.content),
    recommended_next_action: disclosure.action ? recommendNextAction(view) : EXPORT_WITHHELD,
    // W0-B. Redacting `identity` alone is NOT an egress control: the generated
    // summary embeds the endpoint verbatim ("a@b.com from Website — ...") and
    // `metadata` is the RAW source payload, which demonstrably carries the
    // email too. Both are withheld with the endpoint rather than audited
    // field-by-field, because the raw payload's shape is source-defined and
    // cannot be sanitised safely here.
    ai_summary: anyEndpoint ? summarizeLead(view) : EXPORT_WITHHELD,
    status: s(view.status),
    metadata: anyEndpoint ? JSON.stringify(meta) : EXPORT_WITHHELD,
    ...provenanceColumns(view, disclosure),
  };
}

type ProvenanceColumns = Pick<LeadExportRow, 'origin_category' | 'origin_platform' | 'origin_observed_at' | 'origin_source_url' | 'contributors' | 'provenance_status' | 'linked_sources'>;

function provenanceColumns(view: CanonicalLeadView, disclosure: ExportDisclosure): ProvenanceColumns {
  const sources = view.sources ?? [];
  const originating = sources.find((c) => c.role === 'originating') ?? null;
  const url = sanitizeSourceUrl(originating?.sourceUrl);
  return {
    origin_category: s(view.origin?.category),
    origin_platform: s(view.origin?.platform),
    origin_observed_at: s(view.origin?.observedAt),
    // Fail closed: only an explicit grant discloses it; a present-but-withheld
    // URL says so rather than looking absent.
    origin_source_url: !url ? '' : disclosure.sourceUrl === true ? url : EXPORT_WITHHELD,
    contributors: sources
      .map((c) => `${c.role}:${c.sourceCategory}${c.platform ? `/${c.platform}` : ''}@${c.observedAt}`)
      .join('; '),
    provenance_status: s(view.provenanceStatus ?? 'not_applicable'),
    linked_sources: (view.linkedRecords ?? [])
      .map((r) => `${r.sourceLabel}${r.occurredAt ? `@${r.occurredAt}` : ''}`)
      .join('; '),
  };
}

const COLUMNS: Array<keyof LeadExportRow> = [
  'identity', 'company', 'source', 'campaign', 'journey', 'timeline_summary',
  'buying_intent', 'content_interests', 'recommended_next_action', 'ai_summary', 'status', 'metadata',
  'origin_category', 'origin_platform', 'origin_observed_at', 'origin_source_url', 'contributors', 'provenance_status',
  'linked_sources',
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: LeadExportRow[]): string {
  const header = COLUMNS.join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Excel-openable SpreadsheetML 2003 (no dependency). */
export function toExcelXml(rows: LeadExportRow[]): string {
  const cell = (v: string) => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
  const headerRow = `<Row>${COLUMNS.map((c) => cell(c)).join('')}</Row>`;
  const dataRows = rows.map((r) => `<Row>${COLUMNS.map((c) => cell(r[c])).join('')}</Row>`).join('');
  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="Leads"><Table>${headerRow}${dataRows}</Table></Worksheet></Workbook>`;
}
