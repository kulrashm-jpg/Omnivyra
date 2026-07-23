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
 *
 * PHASE E — COMPLETION INTELLIGENCE (additive, opt-in)
 * ---------------------------------------------------
 * The interview must naturally STOP once enough is known and signal a handoff to
 * productive work — rather than mining every last low-value node. That "stop"
 * decision is NOT re-derived here: it is delegated wholesale to the graph's
 * `profileKnowledgeReadiness(...).enoughToProceed` (the core-set signal). Phase E
 * surfaces that terminal state additively:
 *   - a `transition` signal (always present) that mirrors `enoughToProceed` and
 *     carries a stable, DESCRIPTIVE handoff key — a pointer, never a call into a
 *     downstream system (campaign/content/planner are out of scope);
 *   - an OPT-IN `stopWhenEnough` option (default OFF ⇒ byte-identical to Phase
 *     C/D) that, once the core is satisfied, returns a terminal decision
 *     (`nextQuestion: null`, `complete: true`) INSTEAD of selecting another
 *     question. No second completion threshold exists — `complete` here is simply
 *     "no next question remains to ask" (either every node is satisfied, or the
 *     opt-in early-stop fired at the delegated `enoughToProceed`).
 * There is NO downstream workflow here — only the terminal state + handoff signal.
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

/**
 * Phase E — the completion/handoff signal. `ready` mirrors the graph's
 * `enoughToProceed` (no second threshold). `suggestedNext` is a stable,
 * DESCRIPTIVE pointer to what the profile is ready FOR once the core is known —
 * an indicator only, NOT an invocation of any downstream system.
 */
export interface OrchestratorTransition {
  /** True once the knowledge core is satisfied — the interview may hand off. Mirrors enoughToProceed. */
  ready: boolean;
  /** Stable descriptive handoff key naming the next platform workflow, or null when not ready. */
  suggestedNext: string | null;
}

/**
 * The stable, descriptive handoff key surfaced once the company-profile core is
 * satisfied. It names WHAT the profile is now ready for (moving from profiling
 * into productive campaign/content strategy work) as a signal string only — it
 * is deliberately NOT an import, route, or call into any downstream system, in
 * line with the Phase-E scope boundary.
 */
export const PROFILE_CONVERSATION_HANDOFF_KEY = 'campaign-strategy';

export interface OrchestratorDecision {
  /** The graph built from the persisted profile (reuse it; do not rebuild). */
  graph: CompanyKnowledgeGraph;
  /** Highest-value unknown to ask next, or null when nothing remains to ask. */
  nextQuestion: NextQuestion | null;
  /** True once the high-value core is satisfied — the interview MAY stop. */
  enoughToProceed: boolean;
  /**
   * True when there is no next question to ask. Without `stopWhenEnough` this is
   * "every node satisfied" (Phase C/D). With `stopWhenEnough`, it additionally
   * becomes true the moment the core is satisfied (delegated to enoughToProceed).
   */
  complete: boolean;
  /** Canonical readiness snapshot (delegated, unmodified). */
  readiness: ProfileKnowledgeReadiness;
  /** "Already known" + next-gap grounding block (delegated, unmodified). */
  grounding: ReturnType<typeof buildKnowledgeGrounding>;
  /** Node ids already asked this session, derived from the conversation. */
  sessionAsked: string[];
  /**
   * Phase E — completion/handoff signal (additive; always present). `ready`
   * mirrors `enoughToProceed`; when ready, `suggestedNext` carries the stable
   * descriptive handoff key. A signal only — no downstream workflow.
   */
  transition: OrchestratorTransition;
}

/**
 * Phase E — orchestration options (additive; every field optional so existing
 * callers are byte-identical).
 */
export interface OrchestrateOptions {
  /**
   * When true, the interview STOPS as soon as the knowledge core is satisfied:
   * the decision is terminal (`nextQuestion: null`, `complete: true`) rather than
   * selecting another (lower-value) gap. The stop condition is delegated ENTIRELY
   * to `readiness.enoughToProceed` — no second threshold. Default false ⇒ the
   * orchestrator keeps selecting the highest-value gap until every node is
   * satisfied (Phase C/D behaviour, byte-identical).
   */
  stopWhenEnough?: boolean;
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
  options: OrchestrateOptions = {},
): OrchestratorDecision {
  const graph = buildCompanyKnowledgeGraph(profile);
  const sessionAsked = deriveSessionAsked(conversationSoFar);
  const readiness = profileKnowledgeReadiness(graph);
  const grounding = buildKnowledgeGrounding(graph);

  // Phase E — the terminal decision is delegated wholly to enoughToProceed: when
  // opt-in `stopWhenEnough` is set and the core is satisfied, stop interviewing
  // (no next question) instead of mining the remaining low-value gaps.
  const terminal = options.stopWhenEnough === true && readiness.enoughToProceed;
  const nextQuestion = terminal ? null : selectNextProfileQuestion(graph, { sessionAsked });

  return {
    graph,
    nextQuestion,
    enoughToProceed: readiness.enoughToProceed,
    complete: nextQuestion === null,
    readiness,
    grounding,
    sessionAsked,
    transition: {
      ready: readiness.enoughToProceed,
      suggestedNext: readiness.enoughToProceed ? PROFILE_CONVERSATION_HANDOFF_KEY : null,
    },
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
