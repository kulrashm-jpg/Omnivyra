/**
 * PRODUCT INTELLIGENCE PLATFORM — Shared Canonical Contracts.
 *
 * The ONE cross-entity contract surface for Lead / Company / Offering Understanding. These
 * entity-agnostic contracts are the ones proven + production-certified in Program 1 (Lead
 * Intelligence). This module RE-EXPORTS them (single source of truth — no fork) so every entity
 * imports the identical `Facet<T>`, `EvidenceRef`, `ReasoningTrace`, `GraphNodeRef`, etc.
 *
 * Physical home today: `backend/services/leadUnderstanding` (Program 1). A later, non-breaking
 * refactor may re-home the definitions here; consumers importing from this barrel are unaffected.
 */

export type {
  ISOTimestamp,
  EvidenceKind, EvidenceLifecycle, SourceRef, EvidenceRef,
  ContradictionKind, ContradictionResolution, ContradictionRef,
  Facet,
  ReasoningMethod, ReasoningTrace,
  GraphNodeType, GraphEdgeType, GraphNodeRef, GraphEdge,
} from '../../leadUnderstanding/types';
