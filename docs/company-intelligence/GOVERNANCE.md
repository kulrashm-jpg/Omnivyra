# Governance

How the Company Intelligence Platform constitution is enforced, amended, and waived. This document binds all implementation work. It derives from DESIGN-002 (the Production Constitution) and IMPLEMENTATION-001 (the migration blueprint).

---

## 1. The authority of this specification set

- These documents are the **single reference** for all design and implementation work on the platform. They supersede implicit architecture in the current code (DESIGN-002 §15).
- **Conformant** work realizes the specification. **Non-conformant** work is rejected in review regardless of local merit (invariant **P30**).
- The audits (AUDIT-001..004) are **certified facts**. Do not re-audit or re-derive them; cite them.
- The designs (DESIGN-001..002) are **approved**. Do not redesign them.
- The implementation programs (IMPLEMENTATION-001, 002A..H) are **authoritative**. Every coding prompt derives from the matching program and satisfies its certification gates.

## 2. The conformance test (applied to every change)

A change is conformant if and only if it:

1. writes through the single Knowledge write authority (P3),
2. grounds through the Grounding Authority (P11),
3. validates through the Validation Pipeline (P19),
4. uses the canonical confidence vocabulary (P12),
5. leaves every persisted fact explainable (P7), **and**
6. violates none of P1–P30.

Any change that **adds a second** writer, grounding path, confidence vocabulary, or conversation stack is non-conformant — the four singleton invariants (P4) are permanent.

Enforcement mechanism: [`CONFORMANCE-CHECKLIST.md`](CONFORMANCE-CHECKLIST.md), completed on every PR, plus the CI census rules below.

## 3. The CI census rules (structural, permanent)

Each context program installs a permanent conformance counter in CI. These are the machine-checkable core of governance:

| Census | Must be | Installed by | Enforces |
|---|---|---|---|
| Write authority count | 1 | I2A §10 | P3 |
| Confidence-writer count | 1 | I2B §12 | P12 |
| Evidence-collection siloing | 0 siloed reads | I2C §11 | evidence routing |
| Grounding-bypass count | 0 | I2D §17 | P11 |
| Conversation loops outside engine | 0 | I2E §15 | one conversation engine |
| Unregistered LLM calls | 0 | I2F §16 | P16 |
| Inline production prompts | 0 | I2F §16 | prompt governance |
| Direct model reads | 0 | I2F §16 | model governance |
| Direct canonical reads | 0 | I2G §16 | read mediation |
| Unmanaged learning paths | 0 | I2H §16 | P14 |

A PR that raises any census above target cannot merge.

## 4. Amendment process

The full amendment framework and lifecycle live in [`amendments/README.md`](amendments/README.md); the decision rationale for governance-by-amendment is [`adr/ADR-010-constitutional-governance.md`](adr/ADR-010-constitutional-governance.md). In brief — the constitution is versioned (DESIGN-002 §10). To change a frozen contract:

1. **Open an amendment** as a versioned document change (SemVer: MAJOR = breaking contract change, MINOR = additive, PATCH = corrective).
2. **State the audit or operational evidence** motivating it — amendments are evidence-driven, not preference-driven.
3. **Identify affected invariants, gates, and programs.** An amendment touching P1–P30 requires explicit ratification.
4. **The prior constitution remains the standard** until the amendment is ratified (DESIGN-002 §10). Silent divergence is non-conformance.
5. **Propagate** to the affected implementation program(s) and the conformance checklist in the same change.

A coding prompt that requires a decision **not answered** by its program is returned for program amendment — never decided ad hoc (every 002 program, Final Certification).

## 5. Waivers

- A waiver is a **documented, time-boxed exception** recorded against a specific checklist item and PR.
- Waivers **cannot** be granted for the four singleton invariants (P4), P8 (user authority), P14 (learning never changes facts), P19 (universal validation), or P21 (structural tenancy) — these are non-waivable.
- Every waiver names its retirement condition. Standing waivers are audited each phase gate.

## 6. Migration governance

- Every context cutover uses the **off → shadow → compare → enforce → legacy-retired** flag ladder (IMPLEMENTATION-001 §9), reusing the certified canonical-adapter rollout machinery with divergence forensics.
- **Writes migrate before reads** (the write authority is the first strangler seam).
- **Shadow before enforce is mandatory**; the "unauthorized overwrite must be 0" law (AUDIT-004 §1) gates every write-side enforcement.
- **Enforcement is per-tenant** (internal → beta → cohorts → all); the protected production tenants move last.
- Migrations that would weaken a certified strength (user locks, fill-empty, self-domain scrub, cost gating, byte-faithful defaults) are **invalid by definition** (IMPLEMENTATION-001 §18).
- **Measurement precedes movement**: the correction-rate baseline (Phase 0) is stood up before any cutover.

## 7. Phase gates

No workstream may enter enforce for a capability whose upstream phase gate is open (IMPLEMENTATION-001 §6). The phase gates are the synchronization points; the per-program certification gates (each 002 §14–17) are their contents. A phase is complete only when its gate passes in production for all rollout tenants **and** its rollback capability has been demonstrated (not assumed).

## 8. Definition of done (platform)

The platform is complete when: all DESIGN-002 §12 conformance areas pass continuously; all P1–P30 hold; all IMPLEMENTATION-001 §15 production gates are green; all legacy paths are retired or in declared sunset; and the Learning Loop reports correction-rate trends per field family — i.e., the platform measures its own intelligence quality, the terminal certified gap (AUDIT-004 §1).

## 9. Roles

- **Author of a coding prompt:** derives it from the matching program; does not make architectural decisions.
- **Reviewer:** completes the conformance checklist; blocks on any census regression or unwaived violation.
- **Amendment ratifier:** the party authorized to change frozen contracts; records the evidence and version.
- **Phase owner:** verifies the phase gate and demonstrates rollback before advancing.
