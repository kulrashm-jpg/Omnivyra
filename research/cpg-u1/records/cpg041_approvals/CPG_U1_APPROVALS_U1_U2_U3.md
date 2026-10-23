# CPG U1 — Approval Record for CPG-040 Decisions U1, U2, U3

Recorded 2026-09-16. Approves the design in `C:/tmp/cpg040_protocol_amendment/CPG040_PROTOCOL_AMENDMENT.md` (sha256 `03675db1ab2c72aaead25a43f40747762cf93ba95945632762ad20cc3743ed3f`), which is unchanged.

**Status: APPROVED — NOT IMPLEMENTED — NOT FROZEN — NOT REGISTERED.**

## Approvals as given (verbatim)

```
U1 = OSF, public, no embargo, accountable identity + persistent identifier

U2 = APPROVED
     Two pre-registered single-use Bitcoin outputs
     D = 6 confirmations
     K = 12 blocks
     180-day abandonment rule
     Existing CPG-040 void/abort rules

U3 = MODEL B
     Bitcoin block hash + drand
     3-hour separation requirement
     30-day missing-round expiry
     Pinned, independently verifiable BLS implementation
```

## Resolution against CPG-040 §10

| CPG-040 approval item | Status |
|---|---|
| U1 (a) registry | **OSF Registries** — Zenodo no longer an option |
| U1 (b) accountable identity + persistent-identifier type | **Approved in principle.** The identity itself and its identifier value are **not named** |
| U1 (c) public, no embargo | **Approved** |
| U1 (d) identity-level residual (#16/S2) | Not a choice: it exists under any registry. It will be **declared as a limitation** in protocol-003 §20 |
| U2 (a) create and spend two funded outputs | **Approved** as design; the actual funding and spending are later execution acts |
| U2 (b) key custody | **Not stated** |
| U2 (c) D = 6, K = 12, 180-day windows | **Approved** |
| U2 (d) VOID/abort rules | **Approved** (CPG-040 §3.4, §7) |
| U3 model | **Model B** — Bitcoin block hash + drand |
| U3 Δ | **3 h** (`R` = first drand round scheduled ≥ `MTP(H_rand + D) + 3h`) |
| U3 missing-round expiry | **30 days** |
| U3 BLS implementation | **Pinned and independently verifiable.** Selection at implementation, against the CPG-040 §4.2 interface |

## Consequences

**Implementation (protocol-003 + tooling) is unblocked.** It needs no further methodological decision.

**Before the registration and funding execution step**, two items must be supplied. Neither affects the code:

1. **The accountable identity and its persistent identifier** (e.g. the ORCID iD bound to the OSF account) that will own the registration.
2. **Key-custody assignment** for the Bitcoin wallet that creates and spends `O_dev` and `O_ho` (CPG-040 proposed: the operator).

**Unchanged execution precondition:** independent enumerator(s), reference Author, Confirmer, reference adjudicator, ≥ 2 raters and a rater adjudicator — or a recorded absence with the Rung ≤ 2 ceiling.
