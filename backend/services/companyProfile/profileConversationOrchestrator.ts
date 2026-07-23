/**
 * Profile Conversation Orchestrator — CONVERSATION-INTELLIGENCE-001 Phase C.
 *
 * WHY THIS EXISTS (the one component the Phase-1 audit proved ABSENT)
 * ------------------------------------------------------------------
 * The five `define-*` company-profile routes each hand-roll their own
 * conversation loop — two are server-deterministic (index-walk a fixed question
 * list) and three ask the model to emit the next question — with NO shared
 * guarantee of advancement, semantic de-duplication, or never-re-asking known
 * facts. The canonical Company Knowledge Graph
 * (`companyKnowledgeGraph.ts`) already provides every primitive that governance
 * needs (selection, eligibility/dedup, readiness, grounding); what was missing
 * was a single COORDINATOR that walks a conversation over that graph. This file
 * is that coordinator — and NOTHING more.
 *
 * DELEGATION CONTRACT (duplication = failure)
 * -------------------------------------------
 * This module contains NO selection math, NO dedup logic, and NO readiness
 * computation of its own. Every decision is delegated:
 *   - graph build         → buildCompanyKnowledgeGraph(profile)   (continuity is
 *                           derive-from-profile; no new store/table)
 *   - next question       → selectNextProfileQuestion(graph, {sessionAsked})
 *   - eligibility / dedup → isQuestionEligible / resolveQuestionNode
 *   - readiness / grounding → profileKnowledgeReadiness / buildKnowledgeGrounding
 * The ONLY coordination logic here is deriving `sessionAsked` from the
 * conversation (via the graph's own resolveQuestionNode) so the graph can
 * de-prioritise already-asked gaps — an anti-loop primitive, not a re-implemented
 * one.
 *
 * SCOPE: this selects/gates QUESTIONS and reports readiness. It does NOT turn a
 * user answer into profile fields — knowledge EXTRACTION is Phase D. The
 * persisted profile remains the single source of truth for what is "known".
 */

import type { CompanyProfile } from './types';
import {
  buildCompanyKnowledgeGraph,
  selectNextProfileQuestion,
  isQuestionEligible,
  resolveQuestionNode,
  profileKnowledgeReadiness,
  buildKnowledgeGrounding,
  KNOWLEDGE_NODES,
  type CompanyKnowledgeGraph,
  type NextQuestion,
  type ProfileKnowledgeReadiness,
} from './companyKnowledgeGraph';

/**
 * Exact canonical-question → node id index, built once from the graph registry.
 * This recognises a question the ORCHESTRATOR ITSELF emitted (`node.question`)
 * even when that wording does not round-trip through the node's `equivalents`
 * (e.g. "What is your company called?" lacks the keyword `name` its `company`
 * equivalents require; "How big is your team?" lacks `size`). This is identity
 * matching against the registry's own text — NOT a second dedup/resolution engine
 * (semantic equivalence stays wholly inside resolveQuestionNode).
 */
const CANONICAL_QUESTION_TO_NODE: ReadonlyMap<string, string> = new Map(
  KNOWLEDGE_NODES.map((n) => [n.question.trim().toLowerCase(), n.id]),
);

/** A single conversation turn. Shape is intentionally loose to match every route. */
export interface ConversationTurn {
  role?: string;
  content?: string;
}

export interface OrchestratorDecision {
  /** The graph built from the persisted profile (reuse it; do not rebuild). */
  graph: CompanyKnowledgeGraph;
  /** Highest-value unknown to ask next, or null when nothing remains to ask. */
  nextQuestion: NextQuestion | null;
  /** True once the high-value core is satisfied — the interview MAY stop. */
  enoughToProceed: boolean;
  /** True when there is no next question to ask (every node satisfied). */
  complete: boolean;
  /** Canonical readiness snapshot (delegated, unmodified). */
  readiness: ProfileKnowledgeReadiness;
  /** "Already known" + next-gap grounding block (delegated, unmodified). */
  grounding: ReturnType<typeof buildKnowledgeGrounding>;
  /** Node ids already asked this session, derived from the conversation. */
  sessionAsked: string[];
}

/**
 * Derive the node ids already asked THIS SESSION from the conversation. Only
 * interviewer turns are questions (a user turn is an answer, never a question we
 * asked); a turn with no role is treated as an interviewer question so callers
 * that append `{ content }` without a role still accumulate correctly. Resolution
 * is delegated to the graph's resolveQuestionNode — no keyword logic here.
 */
export function deriveSessionAsked(conversation: ConversationTurn[] = []): string[] {
  const asked: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !asked.includes(id)) asked.push(id);
  };
  for (const turn of conversation) {
    const role = String(turn?.role ?? 'assistant').toLowerCase();
    if (role === 'user') continue; // an answer, not a question we asked
    const content = String(turn?.content ?? '');
    // 1. Semantic resolution — equivalent phrasings collapse to one node.
    add(resolveQuestionNode(content));
    // 2. Identity fallback — an exact canonical question the orchestrator emitted
    //    whose wording does not self-resolve through its equivalents (company/team).
    add(CANONICAL_QUESTION_TO_NODE.get(content.trim().toLowerCase()));
  }
  return asked;
}

/**
 * THE canonical coordination step. Given the persisted profile and the
 * conversation so far, build the graph, derive what has been asked, and return
 * the delegated next-question / eligibility / readiness view. Pure &
 * deterministic; no I/O, no persistence.
 */
export function orchestrateProfileConversation(
  profile: CompanyProfile,
  conversationSoFar: ConversationTurn[] = [],
): OrchestratorDecision {
  const graph = buildCompanyKnowledgeGraph(profile);
  const sessionAsked = deriveSessionAsked(conversationSoFar);
  const nextQuestion = selectNextProfileQuestion(graph, { sessionAsked });
  const readiness = profileKnowledgeReadiness(graph);
  const grounding = buildKnowledgeGrounding(graph);
  return {
    graph,
    nextQuestion,
    enoughToProceed: readiness.enoughToProceed,
    complete: nextQuestion === null,
    readiness,
    grounding,
    sessionAsked,
  };
}

/**
 * Structural never-re-ask gate for an arbitrary (e.g. AI-emitted) question: false
 * iff the question maps to a node the graph already marks satisfied. Delegates to
 * the graph's isQuestionEligible over the decision's already-built graph — so a
 * caller never rebuilds the graph or re-implements dedup.
 */
export function isQuestionEligibleForOrchestration(
  decision: OrchestratorDecision,
  questionText: string,
): boolean {
  return isQuestionEligible(decision.graph, questionText);
}
