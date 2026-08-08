/**
 * CI-B201 (assembly) — the ONE caller of the Contact builder. Ingests observed evidence
 * (`contactFromEvidence`) and produces the canonical Understanding + projection. Deterministic
 * (`asOf` passed in). Mirrors the Lead/Company/Offering/Visitor/Journey/Intent/Qualification assembly
 * seam exactly: assembly composes, it never re-derives a semantic the evidence layer already decided.
 *
 * NOT a producer and NOT a runtime consumer: it performs no I/O, registers nothing, and is called by
 * nothing in production. The caller supplies already-fetched observations.
 */

import type { ContactUnderstanding, ContactProjection } from './types';
import type { ContactEvidenceInput } from './fromEvidence';
import { contactFromEvidence } from './fromEvidence';
import { buildContactUnderstanding } from './builder';
import { projectContact } from './projection';

export interface AssembledContact { understanding: ContactUnderstanding; projection: ContactProjection; }

export function assembleContactUnderstanding(input: ContactEvidenceInput): AssembledContact {
  const a = contactFromEvidence(input);
  const understanding = buildContactUnderstanding({
    key: a.key,
    builtAt: input.asOf,
    facets: a.facets,
    evidence: a.evidence,
    contributions: a.contributions,
    edges: a.edges,
    reasoning: a.reasoning,
  });
  const projection = projectContact(understanding, input.asOf);
  return { understanding, projection };
}
