# CPG-U1 — HANDLING THE TOOLING AGGREGATE DURING THIS WINDOW

**CLASSIFICATION: OPERATING RULE.** Nothing here is registered, published, broadcast, committed or pushed. No
OP_RETURN is constructed, no transaction is created, no value is invented. The instrument was read read-only
from `C:/tmp/dt002/research/cpg-u1/tooling` and never written.

**THE RULE, IN ONE LINE:** the pre-wave aggregate is no longer registrable; the post-wave aggregate is
**provisional** until two independent clean rebuilds agree; and until the owner authorises, it goes into no
OP_RETURN, no publication and no registration.

---

## 1. The three states of `tooling_aggregate_sha256`

| State | Value | May it be registered? |
|---|---|---|
| **Pre-wave (superseded)** | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files. Recomputed read-only by this agent at task start **and again** at task end; identical both times. | **NO — no longer registrable.** See section 2. |
| **Post-wave (current)** | `<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>` | **NO — not yet.** Provisional until section 3's conditions are met. |
| **Registrable** | the post-wave value **after** two independent clean rebuilds agree and the owner authorises | **Yes — once, and then never again.** |

**The stale trap.** The worktree `C:/tmp/dt4-uncert` carries its own `research/cpg-u1/tooling`: a **587-file**
tree whose aggregate is `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`. It runs cleanly
and yields a **self-consistent wrong aggregate**, because `toolingManifest(root)` hashes whatever tree it walks.
It was not read as the instrument by this agent. **Any value computed from that tree is wrong and would pass
every check the instrument can perform.**

## 2. Why `f7699f05...` is no longer registrable

Two DECIDED decisions in `C:/tmp/dt009-closure/orchestrator/DECISION_RECORD.md` both change instrument files:

- **DR-1 = option (B):** implement the >= 2 independent-relay floor with per-relay attribution.
  `DR1_DRAND_RELAY_FLOOR_MEMO.md:229` records that the aggregate "moves off `f7699f05...`" and names five files
  (`lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md`).
- **DR-10 = fix before registration:** repair the `cmdScan` duplicate collapse, which changes
  `cpg_u1_data.mjs` and adds a regression fixture and negative controls.

Plus the authorised **`enumerated_by` personnel binding**, which changes the frame path.

`toolingManifest()` (`lib/aggregate.mjs:8-22`) builds one line per file — `<sha256>  <path>` — sorts by path,
concatenates, and hashes the whole text. **Every file of the tree is included, vendored dependencies and all.**
So one changed byte in one file changes one manifest line and therefore the aggregate. There is no "small"
change, and there is no partial or incremental aggregate.

**DR-2 does not move it** (`DR2_CERTENV_WORDING_MEMO.md:194`: "Tooling aggregate impact: None."). Registering
`f7699f05...` now would register the aggregate of an instrument that **does not enforce the relay floor and
still contains the scan defect** — i.e. it would register the wrong instrument, and section 4 explains why that
could not be corrected afterwards.

## 3. When the provisional value becomes registrable — all five conditions, in order

1. **The three isolated implementation trees are merged centrally**, as `DECISION_RECORD.md`'s method note
   requires (separate trees per change, then one reviewable merge — not several agents editing one tree).
2. **The merged tree is re-verified in full**: self-test green; the anchor count re-established; a **full
   mutation run with every mutant KILLED**; adapter conformance. `DR1_DRAND_RELAY_FLOOR_MEMO.md` records that
   two earlier candidate patches were measured and **neither aggregate is registrable, because neither carried
   the required test changes** — a green build alone is not the bar.
3. **The integrity gate holds:** protocol `c50fc680...00b719`, treatment commit `f01a7eb4...`, evaluation tree
   `3b4811fc...`, development registry `a1392952...a70814` and provider configuration `c9a7e9aa...627561` are
   **byte-identical before and after**. `DECISION_RECORD.md`: "Only the tooling aggregate may change. Anything
   else changing is a STOP."
4. **Two independent clean rebuilds agree.** Two separate fresh clones/checkouts of the merged tree, each with
   dependencies installed from scratch, each hashed with `toolingManifest()`, producing the **same** digest.
   One rebuild proves nothing: a build artefact, a lockfile difference, a line-ending change or an editor
   backup left in the tree all change the aggregate silently, and the instrument cannot tell a contaminated
   tree from a clean one. Nothing except an independent rebuild distinguishes them.
5. **The owner authorises that specific value.** No agent may promote a provisional value to registrable, and
   no document — including this one — may be treated as the source of the value.

**Until all five hold, the value is provisional.**

## 4. Why the window is ONE-WAY — the aggregate cannot be repaired after registration

This is the reason for all of the above, and it is mechanical, not a matter of policy.

### 4.1 It is a registered field

`tooling_aggregate_sha256` is one of the 20 top-level keys of `cpg-u1-registration/v1`
(`lib/registration.mjs:33-57`) and is ERROR-checked as 64 lowercase hex.

### 4.2 It sits inside the on-chain commitment digest

`lib/sampling.mjs:142` is:

```js
for (const k of ['registration_id', 'protocol_sha256', 'tooling_aggregate_sha256']) {
  if (p[k] !== reg[k]) return outcome(stage, STATE.VOID_MALFORMED, `committed payload ${k} differs from the registration`);
}
```

`p` is the **committed payload** — the payload whose digest is what the OP_RETURN actually contains, checked
immediately above by `payloadDigest(c.payload) !== decoded.digest`. So the aggregate is bound into the
on-chain commitment: **once a commitment transaction is broadcast, the aggregate it names is irrevocable in the
strongest available sense.** A mismatch between payload and registration is not a warning; it is
`STATE.VOID_MALFORMED`.

### 4.3 It is re-checked on every command, in two independent places

- `registered()` in `cpg_u1_data.mjs` recomputes `toolingManifest(ROOT).aggregate` and, on mismatch, calls
  `fail('VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate ...) is not the registered tooling')`. Every
  sampling and verification command routes through it — `verify-registration`, `verify-sampling`,
  `derive-seed`, the draws.
- `lib/harness.mjs:44` refuses independently:
  `verify(ctx.toolingAggregate === reg.tooling_aggregate_sha256, 'TOOLING_MISMATCH', 'this tooling is not the registered tooling')`.

**So after registration there is no version of the instrument that both differs from the registered aggregate
and can run anything.** A post-registration patch does not produce a patched study; it produces an instrument
that refuses every command, with `VERIFY_ABORT_HASH_MISMATCH` from the CLI and `TOOLING_MISMATCH` from the
harness.

### 4.4 Therefore a repair is a re-registration, and a re-registration is a VOID

The only way to run a corrected instrument would be to register the corrected aggregate — a second
registration. `authority_rule`, a registered field, reads:

> The earliest registration under the accountable identity with this study_id is authoritative; a second
> registration with different sampling fields, or a withdrawal, voids the study.

`checkAuthority()` implements it, and `tooling_aggregate_sha256` is in `SAMPLING_FIELDS`. A second registration
differing in it therefore yields:

> `duplicate registration <id> names different sampling fields — study VOID`

and a withdrawal yields `a registration for this study was withdrawn — study VOID`.

**Conclusion: registering a wrong aggregate has no recovery path. Either the study runs an instrument it did
not register — impossible, every command refuses — or it re-registers, which voids it.** That is why DR-1 and
DR-10 are fixed **before** registration rather than after, and why this is the last moment at which the value
may move.

## 5. Prohibitions for this window — the operating rule

**Until the owner authorises the post-rebuild value:**

1. **No OP_RETURN.** No commitment payload is constructed, no digest computed over a provisional aggregate, no
   transaction built, signed or broadcast. Once broadcast, the aggregate named is irrevocable (section 4.2).
2. **No publication.** The provisional value is not put in a registration draft, an OSF narrative, a public
   note, a commit message, an issue or a chat log as *the* aggregate. Documents in this directory carry the
   literal marker `<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>` and no
   digest.
3. **No registration.** `registration_record.DRAFT.json` is **not** edited to hold a provisional value.
   Verified in `VERIFIER_STATE.md` RUN 4: a record carrying the literal marker is refused with **exit 1** and
   `ERROR tooling_aggregate_sha256 must be 64 lowercase hex characters` — so the marker fails **louder** than
   the nine BLOCKED prerequisites, which is the desired behaviour. A plausible-looking wrong digest, by
   contrast, would pass the form check silently. **This is exactly why the marker is used and no candidate
   digest is written anywhere.**
4. **No funding and no checkpoint selection.** Both are downstream of the aggregate via the commitment digest;
   coin spent against a superseded aggregate is wasted and the outputs must be recreated.
5. **No copying a value out of a document.** Whoever fills the field **recomputes** `toolingManifest()` in the
   exact tree about to be frozen and compares it to the orchestrator's published value. Documents are
   corroboration, never the source. `toolingManifest` hashes whatever tree it is run in, so a value copied
   from prose can be right about a tree nobody is holding.
6. **No further instrument edit after the freeze.** The moment the value is authorised, the instrument tree is
   never touched again — not for a typo, a comment, a README line or a lint fix. Each of those moves the
   aggregate.

## 6. The ordering this implies

```
merge the three implementation trees
  -> full re-verification (self-test, anchors, full mutation run all KILLED, adapter conformance)
  -> integrity gate: protocol / treatment / evaluation tree / registry / provider config byte-identical
  -> clean rebuild #1  ->  aggregate A
  -> clean rebuild #2 (independent)  ->  aggregate B
  -> A == B ?   no -> STOP, find the source of divergence; do not average, do not pick one
              yes -> owner authorises the value
  -> FREEZE: never touch the instrument tree again
  -> write the value into the registration record; recompute it yourself in the frozen tree first
  -> then, and only then: funding, checkpoint, submission, commitments
```

This is `OPERATOR_REGISTRATION_SEQUENCE.md` Stage 1 with the DR-1/DR-10 outcome substituted for its
conditional "if S1 or S2 chose an aggregate-moving route": **that condition is now met, so Stage 1 step S3
(full re-verification) and step S5 (FREEZE) are mandatory, not optional.** Stage 2 (owner inputs that touch no
hash) can and should run in parallel; recruitment is still the longest lead time and blocks no registration
field.

## 7. Documents that quote the superseded value and must be read with this note

| Document | What it says | Correction |
|---|---|---|
| `C:/tmp/dt004-operations/registration/registration_record.DRAFT.json` | `tooling_aggregate_sha256: "f7699f05..."` | **Superseded.** Left unedited so its recorded sha256 stays valid; do not register it. |
| `.../registration_fields.TEMPLATE.json` | same | same |
| `C:/tmp/dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` section 2 | the field is "FILLED" and "Nothing **if DR-1 and DR-2 are settled as no-change**" | Its own condition has now failed: DR-1 was settled as option (B). See `REGISTRATION_FIELD_STATUS.md` group 1a. |
| `.../OSF_METADATA_PREPARED.md` section 3 | recomputed identity table including `f7699f05...` | The aggregate row is superseded; the protocol, registry, treatment and evaluation-tree rows stand. |
| `C:/tmp/dt008-prereg/A-decisions/DR7_DECISION_MEMO.md` section 4.1 | "tooling_aggregate_sha256 f7699f05... unchanged" in the "Objects affected: NONE" clause | A fact correction only; DR-7 still affects no object. Publish the clause with the value **omitted**, or quote the new value. |
| `.../DR8_OPERATIONAL_RULE.md` baseline paragraph | `f7699f05...` (593 files) | Correct as the **pre-wave** baseline it was recorded as. Not a registrable value. |

**All of these are preserved unedited**, in the same discipline as `ERRATA.md`: their recorded hashes stay
valid and this note is read alongside them.

## 8. What this document did NOT do

No registration. No OSF submission. No OP_RETURN, no transaction, no Bitcoin activity of any kind. No
fabricated aggregate, digest, identity or external value — the post-wave aggregate appears **only** as
`<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>`. No protocol or
instrument edit; `C:/tmp/dt002/research/cpg-u1/tooling` was read read-only and its aggregate was confirmed
unchanged at `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files) after all
measurements. No commit, push or pull request. No network, no credentials, no real frame, no U1 execution.
