/**
 * Technical readiness — llms.txt / llms-full.txt structure parse. Pure.
 *
 * llms.txt is a voluntary proposal (llmstxt.org): a markdown file with an H1 title, an optional
 * blockquote summary, and H2 sections of markdown link lists. Its presence is NOT evidence that
 * any AI system reads it, indexes the site, or cites it; its absence is not a documented defect.
 * Nothing here feeds a score.
 */
export const LLMS_TXT_LIMITATION =
  'llms.txt is a voluntary proposal. Its presence is not evidence that any AI system reads it, indexes the site or cites it, and its absence is not a defect any AI provider has documented as affecting visibility.';

export type LlmsTxtStructure = {
  has_h1_title: boolean;
  title: string | null;
  has_summary_blockquote: boolean;
  h2_sections: number;
  link_count: number;
  /** True when the body looks like an HTML document rather than markdown (SPA fallback, soft 404). */
  looks_like_html: boolean;
};

export function parseLlmsTxt(body: string): LlmsTxtStructure {
  const text = (typeof body === 'string' ? body : '').replace(/^﻿/, '');
  const looksLikeHtml = /^\s*(<!doctype html|<html[\s>])/i.test(text);
  const lines = text.split(/\r\n|\r|\n/);
  const firstContent = lines.find((l) => l.trim().length > 0) ?? '';
  const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(firstContent.trim());
  return {
    has_h1_title: !looksLikeHtml && h1 != null,
    title: !looksLikeHtml && h1 ? h1[1].slice(0, 120) : null,
    has_summary_blockquote: !looksLikeHtml && lines.some((l) => /^>\s*\S/.test(l.trim())),
    h2_sections: looksLikeHtml ? 0 : lines.filter((l) => /^##\s+\S/.test(l.trim())).length,
    link_count: looksLikeHtml ? 0 : (text.match(/\[[^\]]*\]\([^)\s]+[^)]*\)/g) || []).length,
    looks_like_html: looksLikeHtml,
  };
}

export type LlmsTxtState = 'present_well_formed' | 'present_malformed' | 'present_exceeds_cap' | 'absent' | 'indeterminate' | 'unavailable';

/** Classify a parsed llms.txt. Well-formed = H1 title and at least one markdown link. */
export function llmsStateFromStructure(structure: LlmsTxtStructure): LlmsTxtState {
  return structure.has_h1_title && structure.link_count > 0 ? 'present_well_formed' : 'present_malformed';
}
