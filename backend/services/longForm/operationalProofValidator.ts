/**
 * Phase 5 — Operational proof realism validator.
 *
 * Targets four pathologies for operational assertions:
 *
 *   IMPOSSIBLE_WORKFLOW          — physically/logically impossible sequencing
 *                                  ("instantly", "without setup", "with zero data")
 *   CONTRADICTORY_EXECUTION      — section claims X works AND opposite of X
 *                                  ("fully automated" + "requires manual review")
 *   FABRICATED_OPERATIONAL_MATURITY — describing the company as at a maturity it isn't
 *                                  (only fires when capability-context lookup fails)
 *   FAKE_SYSTEM_OR_PROCESS       — references a named-sounding system/process the
 *                                  recommendation never mentions
 *
 * Output realism score is 100 minus a penalty per issue.
 */

import type {
  ExtractedClaim,
  OperationalProofValidationResult,
  OperationalRealityIssueType,
  SectionGenerationContract,
} from './longFormRecommendationTypes';

const IMPOSSIBILITY_MARKERS = [
  /\b(instantly|in zero time|with zero (?:data|setup|integration|effort)|no configuration required)\b/i,
  /\b(without (?:any )?(?:setup|integration|onboarding|training|data))\b/i,
  /\b(every team(?:'s)? .* (?:instantly|overnight))\b/i,
  /\b(replaces? (?:all|every) (?:tool|system|workflow))\b/i,
];

interface ContradictionPair {
  a: RegExp;
  b: RegExp;
  detail: string;
}

const CONTRADICTION_PAIRS: ContradictionPair[] = [
  { a: /\bfully automat(?:ed|es)\b/i, b: /\b(requires? (?:manual|human) (?:review|intervention|approval))\b/i, detail: '"fully automated" contradicts "requires manual review"' },
  { a: /\bzero (?:training|setup|onboarding)\b/i, b: /\b(training|setup|onboarding) (?:phase|program|plan)\b/i, detail: '"zero training/setup" contradicts a later mention of training/setup' },
  { a: /\b(eliminates? all (?:errors?|failures?))\b/i, b: /\b(error rate|failure rate|residual (?:risk|errors?))\b/i, detail: '"eliminates all errors/failures" contradicts a residual error/failure rate' },
  { a: /\bin a single (?:click|step)\b/i, b: /\b(?:step \d+|stage \d+|first,|next,|finally,)\b/i, detail: '"single click/step" contradicts a multi-step description' },
];

const FABRICATED_SYSTEM_PATTERNS = [
  /\bour (?:proprietary|patented|signature|flagship) (?:[A-Z][a-zA-Z0-9-]+ )+(?:Engine|System|Platform|Framework|Pipeline)\b/,
  /\b(?:the )?[A-Z][a-zA-Z0-9-]+(?:[A-Z][a-zA-Z0-9-]+)+\s+(?:Engine|System|Platform|Framework|Pipeline)\b/,
];

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface ValidateOperationalProofInput {
  sectionText: string;
  contract: SectionGenerationContract;
  claims: ExtractedClaim[];
}

function knownSystems(contract: SectionGenerationContract): string[] {
  return [
    contract.frameworkName,
    ...contract.frameworkComponents,
    contract.capabilityEmphasis.primaryCapability,
    contract.capabilityEmphasis.workflowCategory ?? '',
    ...contract.terminologyEmphasis.domainVocabulary,
    ...contract.terminologyEmphasis.strategicTerminology,
  ].filter((s) => s && s.trim().length > 0).map((s) => s.toLowerCase());
}

export function validateOperationalProof(input: ValidateOperationalProofInput): OperationalProofValidationResult {
  const plain = stripHtml(input.sectionText);
  const issues: OperationalProofValidationResult['issues'] = [];
  let score = 100;

  // IMPOSSIBLE_WORKFLOW
  for (const re of IMPOSSIBILITY_MARKERS) {
    const m = plain.match(re);
    if (m) {
      issues.push({
        type: 'IMPOSSIBLE_WORKFLOW' as OperationalRealityIssueType,
        detail: `Impossibility marker detected: "${m[0]}". The claim implies a workflow with no setup, no data, or instantaneous execution.`,
        severity: 'high',
      });
      score -= 25;
    }
  }

  // CONTRADICTORY_EXECUTION
  for (const pair of CONTRADICTION_PAIRS) {
    if (pair.a.test(plain) && pair.b.test(plain)) {
      issues.push({
        type: 'CONTRADICTORY_EXECUTION',
        detail: pair.detail,
        severity: 'high',
      });
      score -= 22;
    }
  }

  // FABRICATED_OPERATIONAL_MATURITY — claim of high org maturity not anchored
  // to anything in the contract's capability emphasis.
  const maturityClaims = plain.match(/\b(?:our|the) (?:organization|team|engineering org|platform) (?:has (?:already )?reached|operates at) (?:full|enterprise|world-class) (?:maturity|scale|reliability)\b/i);
  if (maturityClaims) {
    const anchored = knownSystems(input.contract).some((k) => plain.toLowerCase().includes(k));
    if (!anchored) {
      issues.push({
        type: 'FABRICATED_OPERATIONAL_MATURITY',
        detail: 'Section asserts high operational maturity without anchoring to a capability the company actually offers.',
        severity: 'medium',
      });
      score -= 15;
    }
  }

  // FAKE_SYSTEM_OR_PROCESS — named systems not in the contract.
  const known = knownSystems(input.contract);
  for (const re of FABRICATED_SYSTEM_PATTERNS) {
    const matches = plain.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? [];
    for (const m of matches) {
      if (known.some((k) => k.includes(m.toLowerCase()) || m.toLowerCase().includes(k))) continue;
      issues.push({
        type: 'FAKE_SYSTEM_OR_PROCESS',
        detail: `Named system/process "${m.trim()}" appears in the section but is not anchored to the recommendation's capability or terminology emphasis.`,
        severity: 'medium',
      });
      score -= 12;
    }
  }

  // For each operational_assertion claim, check it mentions a known token.
  const operationalClaims = input.claims.filter((c) => c.claimType === 'operational_assertion');
  if (operationalClaims.length >= 3) {
    const anchoredCount = operationalClaims.filter((c) => known.some((k) => c.claimText.toLowerCase().includes(k))).length;
    const anchoredRatio = anchoredCount / operationalClaims.length;
    if (anchoredRatio < 0.4) {
      issues.push({
        type: 'FABRICATED_OPERATIONAL_MATURITY',
        detail: `Only ${Math.round(anchoredRatio * 100)}% of operational assertions reference the recommendation's known capability/terminology — section may be inventing workflows.`,
        severity: anchoredRatio < 0.2 ? 'high' : 'medium',
      });
      score -= anchoredRatio < 0.2 ? 18 : 10;
    }
  }

  return { realismScore: clamp100(score), issues };
}
