# IMPLEMENTATION-002E — Conversation Engine Implementation Program (FULL EDITION)

> **Archival Full Edition.** Maintained version: [`../implementation/IMPLEMENTATION-002E.md`](../implementation/IMPLEMENTATION-002E.md). Frozen at ratification. Changes via [amendments](../amendments/README.md).

WS-C, Phase 5. Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A]–[I2D]. Distinguishing invariant: **no conversation re-asks a satisfied node; no conversation writes a Fact directly** (P8/P10/P19). **Classification: Ready for Development.**

---

## 1. Executive Summary

This program replaces the six certified endpoint-specific conversations with one conversation runtime. Today each chat independently hand-rolls auth, AI calls, JSON parsing, and its own question loop, with three certified failures: the knowledge graph's semantic dedup was adopted by only one of six; cross-chat memory is asymmetric (only 3 of 7 commercial fields cross into the marketing chat); and every chat launders AI output through the client into locked "user truth" with no server-side validation. One chat (define-campaign-purpose) self-drives its loop with repetition risk, and one (define-problem-transformation) injects hardcoded company-agnostic boilerplate. The unified engine dissolves all of this by construction. Because every conversation now consumes a Grounding Context whose constraint section carries the "already-known / never-ask" facts and whose gap section carries the ranked unknown-but-valuable questions — the knowledge graph's dedup and gap-ranking, generalized — **shared memory and universal deduplication are inherited, not re-implemented per chat**. Because conversation turns become Evidence and extracted values pass through the Inference machine → Validation → Knowledge mutation, **conversations can never again write unvalidated AI output as user truth**. The boilerplate fallback is deleted (P20). The program is a per-mode dual-conversation strangle: the engine runs each mode in shadow, its questioning/completion/knowledge output is compared against the legacy endpoint, modes are cut over one at a time (define-target-customer first — it already proves the KG-grounded shape), and the six legacy endpoints are retired.

## 2. Repository Inventory

define-target-customer → the first mode (the reference shape); define-marketing-intelligence / context / campaign-purpose → Replace; define/infer-problem-transformation → Replace (fallback deleted, P20); suggest-competitors → the competitor mode (external knowledge now routed via Evidence). KG semantic dedup / next-question / readiness → Preserve (the universal dedup/gap/completion engines, consumed via Grounding). Per-chat inline question loops (5 variants) → Replace (one runtime loop). Per-chat "pending save" client staging → Replace (engine submits via Inference → Validation → Knowledge — the seam closing the launder gap). Frontend chat state (6 threads in the god hook) → Refactor (one conversation client; frontend flip in Phase 7; engine flip here). `deterministicRefineFallback` → Retire (P20). Conversation prompts are out of boundary — prompt text belongs to Generation.

## 3. Conversation Boundary (frozen)

**Owns:** sessions, conversation nodes (the dialogue-level representation of a target knowledge node), dialogue state, adaptive questioning (ranking/branching/clarification), completion evaluation, follow-up planning, conversation memory. **Does NOT own:** Facts (submits mutations, never writes), Evidence (emits conversation-turn evidence; the Evidence context stores it), Confidence, Grounding (requests contexts, never assembles), Validation (submits to the pipeline, never validates), AI generation + prompt logic (invokes workflows, never writes prompts). The engine is a *driver* — it orchestrates the ask→answer→extract→validate→persist loop by composing the other contexts' contracts, owning only the dialogue.

## 4. Canonical Conversation Runtime

State machine Started → Active(turns) → {Completed | Abandoned}, with Paused/Resumed as Active sub-states. Session lifecycle (mode + target knowledge set + consumer profile bound). Node lifecycle (pending → asked → answered → {extracted → submitted} / skipped / clarifying; a node is never re-asked once its knowledge node is satisfied). Question planning (each turn requests a fresh Grounding Context, takes the top-ranked gap-section question not already satisfied by the constraint section, phrases against known context). Adaptive branching (full → extract+advance; partial → clarification; contradiction → resolution; keep/skip → skip with reason). Partial answers resolved via clarification, never silently dropped. Answer aggregation (multi-field answers decompose into independent Inference submissions). Completion evaluation (readiness = knowledge completeness; `enoughToProceed`). Interruption recovery / resume (deterministic replay from the transcript; no re-asking answered/satisfied nodes). Cancellation (Abandoned; captured turns remain as Evidence; no partial Facts). Determinism where required: question *selection* is deterministic given a Grounding Context; the *answer* is user-supplied.

## 5. Knowledge Completion

Completion targets per mode (the mode's consumer profile — commercial mode → the 7 commercial fields; PT mode → the 9 PT fields). Required vs optional (required drive completion). Dependency graph (node ordering respects field dependencies, derived from KG node relationships). Completion scoring (value-weighted knowledge completeness). Readiness evaluation (`enoughToProceed` when the required core is satisfied at or above the mode's confidence floor). Stop conditions. Completion is a property of knowledge state, not dialogue length — a conversation ends the moment the target knowledge is known, from any starting point (progressive profiling).

## 6. Adaptive Question Engine

Question ranking (highest knowledge-value unsatisfied node from the gap section). Confidence-aware (low-confidence facts → confirmation questions; unknown → open). Contradiction follow-up (KnowledgeContradicted → resolution question → ConfirmFact/CorrectFact). Clarification (scoped to the missing dimension; never re-ask the whole question). Duplicate prevention (constraint section's satisfied nodes permanently ineligible — every equivalent phrasing suppressed). Skipped question handling (recorded with reason; re-surfaced only if higher-value and still unsatisfied). Already-known suppression (checks the Grounding Context before the user's time). User-fatigue handling (per-session question budget + value threshold; prefer `enoughToProceed` over exhaustive interrogation). Certified defects closed: the self-driven loop is replaced by deterministic gap-ranked selection; the boilerplate fallback is deleted — an empty/unchanged turn is an honest outcome (P20).

## 7. Conversation Memory

Session memory (transcript, node states, partial answers, skips, fatigue budget). Persistent memory (dialogue-level annotations; the *authoritative* record of what is known lives in the knowledge graph, read via Grounding). Completed topics (satisfied nodes → permanently dedup-ineligible via the constraint section). Shared-memory law: the engine does not maintain its own competing "what we know" store — it reads the single knowledge graph through Grounding. This is what makes memory shared across all modes: what one conversation learns (submitted as facts), every conversation sees on its next Grounding request — structurally closing the certified cross-chat asymmetry. Guarantee: a satisfied node is ineligible across every mode and session, permanently.

## 8–9. Grounding/Validation & Knowledge Integration

Per-turn Grounding request (constraint+gap sections drive questioning; the engine never assembles grounding). Each mode registers as a consumer with its target field set, confidence floor, and freshness tolerance. Every extracted value is submitted to the Validation Pipeline before it can become a Fact — the seam that closes the launder gap. Completion verification reads the validated, confidence-filtered knowledge state. Contradiction routing (Con-tier contradiction → ContradictFact + a resolution question). Knowledge integration: extracted (validated) → ProposeFact → ObserveFact on auto-approve; user states/confirms → ConfirmFact; user corrects → CorrectFact (+lock, Learning Signal); model conflicts with a confirmed fact → ContradictFact; ambiguous high-impact on a user-authority field → ReviewRequested. The engine holds no write access (WS-K census). Turns emitted as conversation-turn Evidence for traceability.

## 10. Event Integration

ConversationStarted/Paused/Resumed/Completed/Closed, QuestionAsked/Answered (with answer type), CompletionUpdated, ClarificationRequested. Per-session ordering; idempotent; replayable from the transcript; observable (completion rates, dedup suppressions, would-be-rejected counts, question budgets); audited. Conversation-turn evidence and fact mutations are emitted by Evidence/Knowledge respectively (boundary-correct producers).

## 11. Legacy Migration

Per-mode, define-target-customer first: (1) runtime stand-up; (2) commercial mode; (3) marketing mode (full cross-memory replaces 3-of-7 crossing); (4) context mode; (5) campaign-purpose mode (self-driven loop replaced by gap-ranked selection); (6) PT mode (boilerplate fallback deleted); (7) competitor mode; (8) frontend threads (Phase 7). Proof: a CI census confirms zero conversation loops outside the engine and zero client-mediated unvalidated persistence at enforce.

## 12. Shadow & Rollback

Dual conversations (legacy serves; the engine records questioning/extraction/completion). Duplicate comparison (the engine never asks a satisfied node the legacy chat would have re-asked — the dedup rescue measured as suppressed-duplicate count). Completion comparison (engine `enoughToProceed` vs legacy loop termination — equal-or-fewer questions with equal-or-greater coverage). Knowledge comparison (facts the engine *would* submit post-validation vs what legacy persisted — the validation rescue measured as would-be-rejected count). Promotion (per mode per tenant): zero unauthorized re-asks; completion parity or better; zero unvalidated persistence; determinism verified; rollback exercised. Rollback: per-mode, per-tenant flag revert to the legacy endpoint; in-flight sessions resumable from transcripts (append-only); knowledge state lives in the graph; no conversation loss (structural).

## 13. Testing Framework

Conversation lifecycle; completion (progressive profiling from varied start states); duplicate prevention (zero re-asks, any phrasing/mode/session); memory (shared cross-mode; cross-chat knowledge visible on next Grounding request); interruption (state persisted per turn); resume (deterministic replay; no re-asking); contradiction (resolution routing); validation integration (every extracted value carries a token; the launder case blocked); tenancy; performance (turn latency); rollback (no-conversation-loss proof).

## 14. Certification Gates

(1) one Conversation Engine (zero loops outside the engine); (2) zero duplicate questioning (the 1-of-6 dedup gap closed and universal); (3) completion correctness (progressive profiling verified); (4) resume correctness (deterministic; no re-asking; no lost turns); (5) memory correctness (shared cross-mode; asymmetry closed); (6) zero unvalidated persistence (launder gap closed; fallback deleted, P20); (7) Knowledge integration correctness (all persistence via Inference→Validation→mutation; zero direct writes); (8) event correctness; (9) rollback verified; (10) production safety.

## 15. Implementation Sequence

C0 (requires the Grounding+Validation gate + the KG modules) → C1 runtime core → C2 Grounding/Validation integration → C3 adaptive question engine → C4 knowledge completion → C5 memory → C6 Knowledge integration (submission + conversation-turn evidence) → C7 mode configurations (the seven modes) → C8 shadow → C9 mode migration → C10 enforcement → C11 certification → C12 retirement staging.

## 16–17. Certification

**Ready for Development.** Complete scope; the six-chats fragmentation, 1-of-6 dedup, cross-chat asymmetry, launder path, self-driven loop, and boilerplate fallback each map to a census-enforced closure; shared-memory and dedup are inherited from consuming one graph, not re-built. Not "Production Implementation Ready" — awaits the Grounding+Validation gate; on it, upgrades automatically.

---
**Related:** Reference edition [`../implementation/IMPLEMENTATION-002E.md`](../implementation/IMPLEMENTATION-002E.md) · [`IMPLEMENTATION-002D-FULL.md`](IMPLEMENTATION-002D-FULL.md) · [`IMPLEMENTATION-002F-FULL.md`](IMPLEMENTATION-002F-FULL.md) · **Related ADRs:** [ADR-006](../adr/ADR-006-conversation-runtime.md) · **Amendments:** none · **Version:** [v1.0.0](../VERSION.md) · **Certification:** Ready for Development · GATE-5.
