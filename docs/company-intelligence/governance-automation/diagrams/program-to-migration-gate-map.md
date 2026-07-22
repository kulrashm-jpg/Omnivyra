# Diagram — Program-to-Migration-Gate Map

The two-migration coupling (GOV-IMPL-001 §1): governance runtimes are *built* on the governance-build timeline but *promoted to Hard Block* on the platform-migration timeline (IMPLEMENTATION-001..002H, GATE-0..8). A census target like `writer_authority = 1` is achievable only after its platform gate retires the legacy writers.

## Governance enforcement ↔ platform gate

| Governance rule / runtime | Invariant | Platform gate that permits Hard Block | Enforceable now? |
|---|---|---|---|
| Documentation validation (001) | P30 | — | **Yes (migration-independent)** |
| Governance/doc drift (006 spec↔spec) | P30 | — | **Yes** |
| Security (SSRF/authz), Schema, Runtime-shadow, Semantic, Mutation | — / P29 / P4 / P3 | already enforcing | **Yes** |
| Freeze guard (005D) | P30 | — | **Yes** |
| Version/artifact/amendment (007B/C) | — | — | **Yes** |
| `writer_authority` (002) | P3 | GATE-1 (WS-K) | no — after GATE-1 |
| `confidence_writer` (002) | P12 | GATE-2 (WS-T) | no — after GATE-2 |
| Evidence seam (004) | P1 | GATE-3 (WS-E) | no — after GATE-3 |
| `grounding_bypass`, validation-seam (002/004) | P11/P19 | GATE-4 (WS-G/WS-V) | no — after GATE-4 |
| `conversation_loops_outside_engine` (002) | P17 | GATE-5 (WS-C) | no — after GATE-5 |
| `unregistered_llm_calls`/`inline_prompts`/`direct_model_reads` (002) | P16 | GATE-6 (WS-GEN) | no — after GATE-6 |
| `direct_canonical_reads` (002) | P26 | GATE-7 (WS-P) | no — after GATE-7 |
| `unmanaged_learning` (002) | P14 | GATE-8 (WS-L) | no — after GATE-8 |

## The coupling law

```
Governance build timeline:   001/004 → 002/003/006 → 005/007 → 008 → IMPL → CERT
                                                 │ (Report / ratchet)
Platform migration timeline: GATE-0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
                                                 │ (permits Hard Block per rule)
Enforcement hardening = the intersection: a rule Hard-Blocks only after BOTH
its runtime is built AND its platform gate has closed.
```

**Migration-independent subset (enforceable the moment its runtime is built):** documentation, governance/doc drift, security, schema, runtime, freeze, version, artifact, amendment certification. **Phase-gated remainder:** the nine census rules + boundary/seam/code↔spec-drift, promoted per platform gate (GOV-AUTO-002 §6 phase-gating law; GOV-IMPL-001 §6; EXEC-GOV-001 §9 WP-15).

**Related:** [GOV-IMPL-001](../realization/GOV-IMPL-001.md) · [governance-dependency-graph](governance-dependency-graph.md) · [dependency-manifest](../../dependency-manifest.yaml) · [relationships](../appendices/relationships.md).
