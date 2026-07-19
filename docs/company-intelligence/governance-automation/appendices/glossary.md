# Appendix — Governance-Automation Glossary

Defines terms **specific to the governance-automation layer**. Constitutional terms (bounded context, Fact, invariant, gate, singleton, etc.) are defined once in the constitution's [`../../appendices/glossary.md`](../../appendices/glossary.md) and used here unchanged — this glossary does not redefine them.

| Term | Definition |
|---|---|
| **Governance runtime** | One of the eight GOV-AUTO runtimes (docs, census, boundary, seam, merge, drift, release, health). Single-purpose, read-mostly, additive. |
| **Seam** | A point in the code where a constitutional guarantee must hold (the only place Facts may be written, grounding assembled, the model called). |
| **Seam analyzer** | A detector for a seam crossing (GOV-AUTO-004). The detection primitive the census counts and the boundary promotes. |
| **Census rule** | One of the nine countable constitutional guarantees in `dependency-manifest.census_rules` (e.g., `writer_authority`=1). |
| **Census** | The count of seam crossings against a rule's target (GOV-AUTO-002). |
| **Boundary** | An import/structural rule enforcing context isolation/ownership; promoted warn→enforce (GOV-AUTO-003). |
| **Drift** | Divergence between the ratified specification (catalogs/manifest) and actual code/reality (GOV-AUTO-006); *code-drift* or *spec-drift*. |
| **Stage ladder** | Observe → Report → Warn → Soft Block → Hard Block. The shared enforcement lifecycle across census/boundary/seam/drift. |
| **Ratchet** | Soft-Block behavior: block *new* violations while tolerating the migration-legacy baseline — monotonic improvement. |
| **Phase-gating law** | A rule may Hard-Block only after its platform migration gate closes (the two-migration coupling). |
| **Merge gate** | The aggregated per-PR governance verdict (GOV-AUTO-005). |
| **Freeze guard** | The non-waivable gate blocking edits to ratified documents without a linked amendment. |
| **Evidence bundle** | An immutable, content-addressed, version-pinned set of runtime outputs enabling reproducible certification/release (GOV-AUTO-007, GOV-CERT-001). |
| **Repository health posture** | The single derive-only rollup of domain healths (GOV-AUTO-008). |
| **Certification of record** | A durable, versioned, lifecycle-managed attestation that an implementation conforms to its spec (GOV-CERT-001) — the governance analog of RATIFICATION. |
| **Derive-only** | A runtime that computes nothing independently; every value derives from consumed authoritative outputs (008, GOV-CERT-001). |
| **Migration-independent subset** | Governance enforceable now, without the platform migration (docs, governance/doc drift, security, schema, runtime, freeze, version, artifact, amendment). |
| **Work package (WP)** | An engineering unit converting one IMPLEMENT-GOV-001 task into owned, sequenced, validatable work (EXEC-GOV-001). |
| **Reuse-first** | The mandate to compose existing analyzers/reports rather than re-implement (single-runtime doctrine at the tooling level). |

**Related:** [constitution glossary](../../appendices/glossary.md) · [invariants](../../appendices/invariants.md) · [relationships](relationships.md).
