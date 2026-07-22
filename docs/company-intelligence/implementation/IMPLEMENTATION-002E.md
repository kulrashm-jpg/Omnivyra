# IMPLEMENTATION-002E — Conversation Engine Implementation Program v1.0

**Status:** Authoritative program for the Conversation Engine (WS-C, Phase 5). Inputs frozen: [A1–A4], [D1], [D2], [I1], [I2A], [I2B], [I2C], [I2D]. Distinguishing invariant: **no conversation re-asks a satisfied node; no conversation writes a Fact directly** (P8/P10/P19).

**Classification: Ready for Development.**

---

## 1. Executive Summary

Replaces six endpoint-specific conversations [A3 §4] with **one runtime**. Closes three certified failures: KG dedup adopted 1-of-6 [A3 §3]; cross-chat memory asymmetric (3 of 7 commercial fields cross) [A4 §6]; every chat launders AI output through the client into locked "user truth" [A3 §7]. Because every conversation consumes a Grounding Context whose constraint section carries "already-known/never-ask" and gap section carries ranked questions, **shared memory and universal deduplication are inherited, not re-implemented**. Because turns become Evidence and extractions pass Inference → Validation → mutation, **conversations can never write unvalidated output as user truth**. The boilerplate fallback [A4 §7] is deleted (P20). A per-mode dual-conversation strangle.

## 2. Repository Inventory

define-target-customer → first mode (reference shape); define-marketing-intelligence/context/campaign-purpose → Replace; define/infer-problem-transformation → Replace (fallback deleted); suggest-competitors → competitor mode. KG dedup/gap/readiness → Preserve (consumed via Grounding). Per-chat loops + client staging → Replace. Frontend chat threads → Refactor (Phase 7). deterministicRefineFallback → Retire (P20). Prompts out of boundary (Generation owns).

## 3. Conversation Boundary (frozen)

**Owns:** sessions, nodes, dialogue state, adaptive questioning, completion, clarification, follow-up planning, conversation memory. **Does NOT own:** Facts (submits mutations), Evidence (emits turns), Confidence, Grounding (requests contexts), Validation (submits), AI/prompt logic (invokes workflows). A driver composing other contexts' contracts.

## 4. Runtime Specification

State machine Started → Active(turns) → {Completed | Abandoned} + Paused/Resumed. Session lifecycle (mode + target set + consumer profile bound); node lifecycle (never re-asked once satisfied); question planning (fresh Grounding Context per turn, top gap not satisfied by constraint); adaptive branching (full/partial/contradiction/skip); answer aggregation (per-node extractions); completion evaluation (knowledge completeness, `enoughToProceed`); interruption recovery/resume (deterministic replay from transcript); cancellation (Abandoned; turns remain as Evidence; no partial Facts).

## 5. Knowledge Completion

Target sets per mode (consumer profile); required vs optional; dependency graph; value-weighted completeness; readiness = required core at floor; stop conditions. Completion is a property of knowledge state, not dialogue length.

## 6. Adaptive Question Engine

Gap-ranked selection; confidence-aware (low → confirmation questions); contradiction follow-up (→ resolution); clarification (scoped); duplicate prevention (constraint section, permanent); skip handling; already-known suppression; user-fatigue budget. Self-driven loop [A4 §4] replaced by deterministic selection; boilerplate fallback deleted (P20).

## 7. Conversation Memory

Session (transcript, node states, partial answers, skips, budget) + persistent (dialogue annotations; authoritative knowledge lives in the graph read via Grounding). Shared-memory law: the engine reads one knowledge graph — what one conversation learns, all modes see (closes [A4 §6]). Guarantee: a satisfied node is ineligible across every mode and session, permanently.

## 8–9. Grounding/Validation & Knowledge Integration

Per-turn Grounding request; extraction → Validation (the seam closing [A3 §7]); completion reads validated state; contradiction routing. Knowledge: extracted → ProposeFact→ObserveFact; user states → ConfirmFact; corrects → CorrectFact (+lock, Learning Signal); conflict → ContradictFact; ambiguous high-impact → ReviewRequested. Engine holds no write access (WS-K census). Turns emitted as conversation-turn Evidence.

## 10. Event Integration

ConversationStarted/Paused/Resumed/Completed/Closed, QuestionAsked/Answered, CompletionUpdated, ClarificationRequested. Per-session ordering; idempotent; replayable from transcript; observable; audited.

## 11. Legacy Migration

Per-mode, define-target-customer first: (1) runtime stand-up; (2) commercial mode; (3) marketing mode (full cross-memory); (4) context mode; (5) campaign-purpose mode (gap-ranked); (6) PT mode (fallback deleted); (7) competitor mode; (8) frontend threads (Phase 7). Proof: CI census — zero conversation loops outside the engine; zero client-mediated unvalidated persistence.

## 12–13. Shadow & Rollback

Dual conversations + dedup/completion/knowledge/would-be-rejected comparison; promotion on zero unauthorized re-asks + completion parity + zero unvalidated persistence. Rollback: per-mode revert; transcripts append-only, resumable; knowledge in the graph; no conversation loss (structural).

## 14. Testing

Lifecycle, completion (progressive profiling), duplicate prevention (zero re-asks), memory (cross-mode), interruption, resume, contradiction, validation integration ([A3 §7] blocked), tenancy, performance, rollback.

## 15. Certification Gates

(1) one engine; (2) zero duplicate questioning; (3) completion correctness; (4) resume correctness; (5) memory correctness (closes [A4 §6]); (6) zero unvalidated persistence (fallback deleted); (7) Knowledge integration (zero direct writes); (8) event correctness; (9) rollback verified; (10) production safety.

## 16. Implementation Sequence

C0 (requires **Grounding+Validation gate** + KG modules) → C1 runtime core → C2 Grounding/Validation integration → C3 adaptive question engine → C4 knowledge completion → C5 memory → C6 Knowledge integration → C7 mode configurations → C8 shadow → C9 mode migration → C10 enforcement → C11 certification → C12 retirement.

## 17–18. Certification

**Ready for Development.** Complete scope; six-chats fragmentation, 1-of-6 dedup, cross-chat asymmetry, launder path, self-driven loop, boilerplate fallback each map to a census-enforced closure. Shared-memory and dedup inherited from consuming one graph. Not "Production Implementation Ready" — awaits the Grounding+Validation gate; on it, upgrades automatically.

---
**Related:** [IMPLEMENTATION-002D](IMPLEMENTATION-002D.md) · [IMPLEMENTATION-002F](IMPLEMENTATION-002F.md) · **Depends on:** I1, I2A–D · **Related ADRs:** [ADR-006](../adr/ADR-006-conversation-runtime.md) · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/IMPLEMENTATION-002E-FULL.md`](../full/IMPLEMENTATION-002E-FULL.md) · **Certification:** Ready for Development · GATE-5. See [`../appendices/relationships.md`](../appendices/relationships.md).
