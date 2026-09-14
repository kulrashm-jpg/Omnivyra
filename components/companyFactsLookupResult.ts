/**
 * CPG-012 — what the Company Profile form does with a facts-lookup response.
 *
 * The lookup now returns a fact only when grounding confirmed it for THIS
 * company, and explains the rest. This decides which blanks to fill and what to
 * tell the user; it never fills a value the response did not confirm, and it
 * never overwrites what the user already entered.
 */

export type CompanyFactKey = 'founded_year' | 'team_size' | 'revenue_range';

export interface CompanyFactsLookupPayload {
  facts?: Partial<Record<CompanyFactKey, string | null>>;
  matched_label?: string | null;
  source?: string;
  grounding?: {
    message?: { basis: string | null; identityNote: string | null; notPrefilled: string[]; nothingPrefilled: string };
  } | null;
  error?: string;
}

const ORDER: readonly CompanyFactKey[] = ['founded_year', 'team_size', 'revenue_range'];
const LABEL: Record<CompanyFactKey, string> = { founded_year: 'founded year', team_size: 'team size', revenue_range: 'revenue range' };
const MANUAL = 'Please fill these facts in manually, then Save.';

export function interpretCompanyFactsLookup(
  data: CompanyFactsLookupPayload,
  current: Partial<Record<CompanyFactKey, string | null | undefined>>,
): { fills: { key: CompanyFactKey; value: string }[]; message: string } {
  const message = data.grounding?.message;
  // Only a grounded response may fill the form. Anything else (an error, or a
  // response without grounding) fills nothing rather than trusting a bare value.
  if (data.source !== 'cpg_grounding' || !message) {
    return { fills: [], message: `Public records could not be checked right now. ${MANUAL}` };
  }
  const fills = ORDER
    .filter((k) => !current[k] && data.facts?.[k])
    .map((k) => ({ key: k, value: String(data.facts![k]) }));
  const extras = [message.identityNote, ...message.notPrefilled].filter((s): s is string => !!s);

  if (fills.length > 0) {
    const basis = message.basis ? ` — ${message.basis}` : '';
    return { fills, message: [`Filled ${fills.map((f) => LABEL[f.key]).join(', ')} from public records${basis}.`, ...extras, 'Review, add anything missing, then Save.'].join(' ') };
  }
  const confirmed = ORDER.filter((k) => data.facts?.[k]);
  if (confirmed.length > 0) {
    return { fills, message: [`Public records confirmed ${confirmed.map((k) => LABEL[k]).join(', ')}, which already ${confirmed.length === 1 ? 'has a value' : 'have values'} — nothing was changed.`, ...extras].join(' ') };
  }
  return { fills, message: [message.nothingPrefilled, ...extras, MANUAL].join(' ') };
}
