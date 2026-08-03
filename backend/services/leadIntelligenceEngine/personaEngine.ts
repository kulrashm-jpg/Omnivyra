/**
 * INT-001 Phase 2 — Persona Intelligence.
 *
 * Classifies the lead into a persona using the captured profile (job title,
 * company, email domain) and observed behaviour (visited page categories).
 * Deterministic: each configured persona rule accumulates evidence points; the
 * highest-scoring persona wins, with ties broken by config order. Confidence is
 * the winning score normalized against the configured saturation score.
 */

import type { LeadCaptureSnapshot, Persona, PersonaIntelligence } from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';

export function emailDomainOf(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

interface Candidate {
  persona: Persona;
  score: number;
  reasons: string[];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Boundary-aware keyword match so e.g. "director" never matches "cto". */
const titleMatches = (title: string, keyword: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i').test(title);

export function classifyPersona(
  snapshot: LeadCaptureSnapshot,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): PersonaIntelligence {
  const config = resolveEngineConfig(configOverride);
  const personaCfg = config.persona;
  const behavior = precomputed ?? analyzeBehavior(snapshot, config);

  const title = (snapshot.lead.jobTitle ?? '').trim().toLowerCase();
  const domain = emailDomainOf(snapshot.lead.email);
  const isFreeDomain = domain !== null && personaCfg.freeEmailDomains.includes(domain);

  const candidates: Candidate[] = [];

  // Student is a dedicated domain-driven rule.
  if (domain && personaCfg.studentDomainSuffixes.some((s) => domain.endsWith(s))) {
    candidates.push({
      persona: 'Student',
      score: personaCfg.studentPoints,
      reasons: [`Academic email domain (${domain})`],
    });
  }

  for (const rule of personaCfg.rules) {
    let score = 0;
    const reasons: string[] = [];

    const titleHit = title ? rule.titleKeywords.find((k) => titleMatches(title, k)) : undefined;
    if (titleHit) {
      score += rule.titlePoints;
      reasons.push(`Job title "${snapshot.lead.jobTitle}" matches "${titleHit}"`);
    }

    if (domain && !isFreeDomain && rule.domainKeywords.length > 0) {
      const domainHit = rule.domainKeywords.find((k) => domain.includes(k));
      if (domainHit) {
        score += rule.domainPoints;
        reasons.push(`Email domain ${domain} suggests ${rule.persona.toLowerCase()} ("${domainHit}")`);
      }
    }

    if (rule.behaviorCategories.length > 0 && rule.behaviorPoints > 0) {
      const visited = rule.behaviorCategories.filter((c) => (behavior.categoryPages.get(c)?.size ?? 0) > 0);
      if (visited.length > 0) {
        score += visited.length * rule.behaviorPoints;
        reasons.push(`Visited ${visited.join(', ')} pages`);
      }
    }

    if (score > 0) candidates.push({ persona: rule.persona, score, reasons });
  }

  if (candidates.length === 0) {
    return { persona: 'Unknown', confidence: 0, reasons: ['No title, domain or behavioural signal matched a persona'] };
  }

  // Highest score wins; ties resolve to the earliest-pushed candidate (config order).
  let winner = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.score > winner.score) winner = candidate;
  }

  if (winner.score < personaCfg.minScore) {
    return {
      persona: 'Unknown',
      confidence: 0,
      reasons: [`Best signal (${winner.persona}, ${winner.score} pts) is below the ${personaCfg.minScore} pt threshold`],
    };
  }

  const confidence = Math.min(
    personaCfg.maxConfidence,
    Math.round((winner.score / personaCfg.saturationScore) * personaCfg.maxConfidence * 100) / 100,
  );

  return { persona: winner.persona, confidence, reasons: winner.reasons };
}
