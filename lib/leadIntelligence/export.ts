/**
 * Repository-backed export rows + serializers (CSV + Excel SpreadsheetML).
 *
 * Pure: a unified `CanonicalLeadView` (+ optional enrichments) → one flat export
 * row, then to CSV or Excel-openable XML. No source-specific logic, no dependency.
 */

import type { CanonicalLeadView } from './types';
import { recommendNextAction, summarizeLead } from './recommendations';

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
}

/** Fail-closed default: discloses no endpoint and no action. */
export const DISCLOSE_NOTHING: ExportDisclosure = { email: false, phone: false, action: false };

/** What a reader sees instead of a withheld value. */
export const EXPORT_WITHHELD = '[withheld: contact governance]';

const s = (v: unknown): string => (v == null ? '' : String(v));
const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;

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
    company: s(meta.company_name ?? meta.company ?? view.organizationId),
    source: s(view.sourceLabel),
    campaign: s(view.campaign),
    journey: s(view.attribution.originalSource ? `${view.attribution.originalSource} → ${view.source}` : view.source),
    timeline_summary: s(extras?.timelineSummary ?? view.occurredAt),
    buying_intent: `${Math.round(intentOf(view) * 100)}%`,
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
  };
}

const COLUMNS: Array<keyof LeadExportRow> = [
  'identity', 'company', 'source', 'campaign', 'journey', 'timeline_summary',
  'buying_intent', 'content_interests', 'recommended_next_action', 'ai_summary', 'status', 'metadata',
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
