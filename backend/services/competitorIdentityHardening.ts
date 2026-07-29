/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4 — Competitor Intelligence identity hardening (pure).
 *
 * Competitor Intelligence must CONSUME canonical company identity and reason ONLY about competitors — it
 * must never infer/repair/reclassify the owner company's identity. These pure helpers gate the two
 * remaining competitor-workflow identity-inference surfaces behind the authoritative flag:
 *   • the LLM "understand THIS company" prompt (which asked the model to infer the owner's product category);
 *   • the hardcoded sparse-context identity fabrication in the discovery extractor.
 * Flag OFF (default) ⇒ byte-identical legacy behaviour (O(1) rollback). Flag ON ⇒ canonical-only: the prompt
 * consumes the given identity and reasons about the competitive ARENA; the extractor abstains instead of
 * fabricating. These are NOT the legacy classifiers (classifyCompanyBusiness/inferEntityArchetype/
 * inferCompanyDomainShape) — those remain for U5 classifier retirement.
 */

/**
 * Turn-0 competitor "understanding" system prompt. Authoritative ⇒ the canonical identity is GIVEN; the LLM
 * describes the competitive arena using it verbatim and is forbidden to re-infer/reclassify the company.
 * Non-authoritative ⇒ the exact legacy string (byte-identical).
 */
export function buildCompetitorUnderstandingSystemPrompt(authoritative: boolean): string {
  if (authoritative) {
    return (
      "You are a sharp competitive-intelligence analyst. The company's canonical identity — its product " +
      'CATEGORY, what it sells, and who it serves — is ALREADY ESTABLISHED and provided in the profile below. ' +
      'Do NOT re-infer, re-classify, repair, or change the company\'s identity. In 3–4 confident, specific ' +
      'sentences, describe the COMPETITIVE ARENA this company operates in (the space its direct rivals occupy ' +
      'and how buyers choose between them), using the given identity verbatim and grounded strictly in the ' +
      'profile (never invent). Return JSON ONLY: { "understanding": string }.'
    );
  }
  return (
    'You are a sharp competitive-intelligence analyst. In 3–4 confident, specific sentences, state your ' +
    'understanding of THIS company: the exact product CATEGORY it competes in, what it actually sells, who it ' +
    'serves, and the competitive arena — grounded strictly in the profile (never invent). ' +
    'Return JSON ONLY: { "understanding": string }.'
  );
}

/**
 * Whether the discovery extractor may fabricate a hardcoded owner identity when the extracted context is
 * sparse. Authoritative ⇒ NO (abstain; canonical identity is supplied upstream). Non-authoritative ⇒ YES
 * (legacy sparse-context fallback preserved).
 */
export function mayFabricateSparseIdentity(authoritative: boolean): boolean {
  return !authoritative;
}
