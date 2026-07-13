/**
 * contentWriterKnowledge.ts — CKC-001 knowledge adapter for the Content Writer
 * (PMF-001 §3).
 *
 * Replaces the bespoke `getProfile`/`buildCompanyContext` brand-context lookup
 * with CKC-001. It maps the CKC knowledge domains to the EXACT brand-context lines
 * the legacy path produced (same fields, same order, same labels), so the prompt —
 * and therefore generation behavior — stays equivalent. Because CKC composes from
 * the same company_profiles columns buildCompanyContext read, the values match;
 * when an ACTIVE knowledge version exists, CKC serves that versioned knowledge
 * (an improvement, guarded by the migration flag + dual-run parity).
 */

import { getKnowledgeContext } from '../knowledgeConsumption/companyKnowledgeConsumer';
import type { KnowledgeContext } from '../knowledgeConsumption/knowledgeContextContracts';
import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';

/** CKC domains the Content Writer needs (CONTENT_WRITER consumer + INDUSTRY). */
export const CONTENT_WRITER_DOMAINS: KnowledgeDomainId[] = [
  'IDENTITY', 'INDUSTRY', 'POSITIONING', 'BRAND', 'AUDIENCE', 'MARKETING', 'PRODUCTS', 'SERVICES',
];

function field(knowledge: KnowledgeContext, domain: KnowledgeDomainId, key: string): string | null {
  const v = knowledge.knowledge?.[domain]?.fields?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Map CKC knowledge → the brand-context block, parity with the legacy
 * buildCompanyContext lines (Company / Industry / Value proposition / Tone of
 * voice / Target audience / Key messages). Pure.
 */
export function knowledgeToBrandContext(knowledge: KnowledgeContext | null): string {
  if (!knowledge) return '';
  const parts: string[] = [];
  const name = field(knowledge, 'IDENTITY', 'name');
  const industry = field(knowledge, 'INDUSTRY', 'industry');
  const uniqueValue = field(knowledge, 'POSITIONING', 'unique_value');
  const brandVoice = field(knowledge, 'BRAND', 'brand_voice');
  const targetAudience = field(knowledge, 'AUDIENCE', 'target_audience');
  const keyMessages = field(knowledge, 'MARKETING', 'key_messages');

  if (name) parts.push(`Company: ${name}`);
  if (industry) parts.push(`Industry: ${industry}`);
  if (uniqueValue) parts.push(`Value proposition: ${uniqueValue}`);
  if (brandVoice) parts.push(`Tone of voice: ${brandVoice}`);
  if (targetAudience) parts.push(`Target audience: ${targetAudience}`);
  if (keyMessages) parts.push(`Key messages: ${keyMessages}`);
  return parts.join('\n');
}

export interface ContentWriterKnowledge {
  brandContext: string;
  knowledgeVersion: number | null;
  context: KnowledgeContext | null;
}

/**
 * Acquire Content Writer knowledge through CKC-001 (the ONLY Company Knowledge
 * source after migration). Never throws — returns an empty brand context on
 * unavailability (matching legacy behavior when no profile exists).
 */
export async function getContentWriterKnowledge(
  companyId: string,
  opts: { now?: string; correlationId?: string } = {},
): Promise<ContentWriterKnowledge> {
  const context = await getKnowledgeContext({
    companyId,
    consumer: 'CONTENT_WRITER',
    domains: CONTENT_WRITER_DOMAINS,
    mode: 'summary',
    now: opts.now,
    correlationId: opts.correlationId,
  });
  return {
    brandContext: knowledgeToBrandContext(context),
    knowledgeVersion: context?.metadata.version ?? null,
    context,
  };
}
