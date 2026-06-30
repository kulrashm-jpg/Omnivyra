/**
 * Shared deterministic primitives for the website intelligence engines (Phase 18).
 * Pure, no I/O, no LLM. The score/confidence/freshness primitives are now owned by the
 * Platform Confidence + Freshness engines (Phase 21B) and re-exported here so every
 * website engine import path stays byte-identical. Only website-specific text helpers
 * (readability, word counting, page matching) live in this file.
 */
export type { IntelHealth, Readiness, Provenance, CheckResult } from '../platformIntelligence/confidence';
export { clamp, healthFromScore, readinessFromScore, aggregate } from '../platformIntelligence/confidence';
export type { Freshness } from '../platformIntelligence/freshness';
export { freshnessFrom } from '../platformIntelligence/freshness';

import { clamp } from '../platformIntelligence/confidence';

const words = (t: string): string[] => (t || '').trim().split(/\s+/).filter(Boolean);
export const wordCount = (t: string): number => words(t).length;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch Reading Ease (0..100, higher = easier). Deterministic; returns null for too-little text. */
export function fleschReadingEase(text: string): number | null {
  const ws = words(text);
  if (ws.length < 20) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const score = 206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / ws.length);
  return clamp(score);
}

export const norm = (s: string | null | undefined): string => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Does any of the page's identifiers (url/title/page_type) match a keyword? */
export const matchesPage = (p: { url?: string; title?: string | null; page_type?: string | null }, kws: string[]): boolean => {
  const hay = `${norm(p.url)} ${norm(p.title)} ${norm(p.page_type)}`;
  return kws.some((k) => hay.includes(k));
};
