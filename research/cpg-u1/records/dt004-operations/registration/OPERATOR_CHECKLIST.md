# CPG-U1 OPERATOR CHECKLIST — registration and sampling

**CLASSIFICATION: PREPARATION.** No step below has been performed. Every command is quoted from the
verified instrument's own command surface (`README.md` "Commands", `cpg_u1_data.mjs` `COMMANDS`).
Exit codes are the instrument's documented codes. Nothing in this file constitutes evidence, and no
step here may be executed by an agent on the operator's behalf.

**Instrument:** `C:/tmp/dt002/research/cpg-u1/tooling` (aggregate
`<NEW_AGG>`, <NEW_N> files) — **uncommitted**.
**Protocol:** `CPG_U1_PROTOCOL_004`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`.

---

## 0. Two rules that govern the whole ordering

### 0.1 §5.5.1 ordering rule — registration precedes frame construction

Protocol-004 §5.5.1 "Ordering": **funding confirmed (≥ 6 at the checkpoint) → registration → frame
construction → development commitment.** §5.5 step 3 repeats it: the complete frame `F` is
enumerated *after* the freeze, and there are **NO LATER ADDITIONS**.

This is not merely procedural. The frame must be complete and sufficient (§5.7.2) *before* the
development commitment, and the frame hash is inside the on-chain digest before the randomness block
exists. **Do not construct, enumerate, extend or reclassify any frame before the registration record
exists with its registry-issued `registration_id` and `registration_timestamp`.**

### 0.2 Disclosure: the protocol says "tooling v4"; the instrument is `cpg-u1-data-tooling-6`

Protocol-004 (line 18 and the closing line) says it governs "tooling v4". The instrument reports
`TOOL_VERSION = 'cpg-u1-data-tooling-6'`. **Identity is the aggregate**, not the version string: the
protocol's governed-tooling row states the aggregate "is bound in the registration record ..., not
in this file". The protocol is **frozen and must not be edited** — any edit changes
`protocol_sha256` and invalidates the registration. Record this disclosure in the registration
narrative; do not reconcile it by editing either artefact.

---

## Phase A — before any Bitcoin activity

**A1. Decide AD-1..AD-9, or decide not to.**
The nine methodological decisions in `rules/analysis_decisions.json` are all `UNDECIDED`. That file
is inside the tooling aggregate. Editing it changes the aggregate, and the aggregate is frozen by
registration. **Decide them now or accept that `analyze` will exit 4 (`ANALYSIS_BLOCKED`) at the end
of the study with no lawful way to fix it.**
Outcome to keep: the final `rules/analysis_decisions.json`, and its sha256.
HUMAN: H2. Expected state after this step: the aggregate is either `<NEW_AGG>` (unchanged) or a new
value that becomes the registered aggregate.

**A2. Confirm the protocol states every pinned parameter.**
```
node cpg_u1_data.mjs verify-protocol --protocol CPG_U1_PROTOCOL_004.md
```
Expected exit **0**, printing `protocol_sha256: c50fc680...`. A non-zero exit means the protocol text
lacks a normative marker — investigate, do **not** edit the protocol.
Keep: the printed `protocol_sha256`.

**A3. Name the Bitcoin wallet-key custodian and compute the pre-registration values.**
Required before A4 can pass: `bitcoin_key_custodian.value` (role is pinned `STUDY_OPERATOR`).
Also fix now, because §19.1 requires them before registration: `as_of` (one frozen ISO-8601 UTC
timestamp for the whole held-out run) and `provider_configuration_sha256` (over `registry/builtins.ts`
+ `coverageInventory.ts`, §13.1).
HUMAN: H1 for `as_of` and `provider_configuration_sha256` (an agent can compute and propose, a human
signs); H2 for the custodian.

**A4. Produce the registration template.**
```
node cpg_u1_data.mjs registration-fields \
  --protocol CPG_U1_PROTOCOL_004.md \
  --registry rules/development_only_registry.json \
  --out reg.json
```
Expected exit **0**. It prints
`registration template written: identities, outpoints, checkpoint and registry-issued fields are UNASSIGNED`
and `tooling_aggregate_sha256: <aggregate>`.
**Check that printed aggregate against §1.1 of `REGISTRATION_PACKAGE.md`.** If A1 changed the
decisions file, it will not be `<NEW_AGG>`; that is expected, and the new value is the one that
gets registered.
Keep: `reg.json` (write-once — a refused command writes nothing, and an existing output is not
overwritten), and the printed aggregate.

**A5. Fill the human fields into `reg.json`.**
Fill: `bitcoin_key_custodian.value`, `accountable_identity.value`, `persistent_identifier.type`,
`persistent_identifier.value`, `as_of`, `provider_configuration_sha256`. Leave `outpoints`,
`checkpoint`, `registration_id`, `registration_timestamp` as `UNASSIGNED` for now.
Never write a value containing `SYNTHETIC` — it is refused outside `--allow-synthetic`.

**A6. Gate funding on the custodian being named.**
```
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
```
Expected exit **0**, printing
`funding prerequisites present: key custodian assigned (role STUDY_OPERATOR); parameters match the pinned values.`
and `The tooling creates no key and no transaction. Funding is an external act outside this tool.`
Exit **4** = BLOCKED, the custodian is still `UNASSIGNED`. Exit **1** = a pinned parameter was
altered; restart from A4 with a clean `reg.json`.
**Do not fund before this command exits 0.**

---

## Phase B — funding and the checkpoint (external; see `BITCOIN_RANDOMNESS_RUNBOOK.md`)

**B1.** Key custodian creates `O_dev` and `O_ho`: two **distinct** single-signature **P2WPKH**
outputs on `bitcoin-mainnet`. HUMAN: H2. The tooling creates no wallet, no key, no transaction.

**B2.** Wait until each funding transaction has **≥ D = 6 confirmations**, then choose the checkpoint
block `(height, hash)` at or after both, satisfying `funding_height + 6 − 1 ≤ checkpoint_height`.

**B3.** Obtain two independently sourced header archives (see `HEADER_AND_RELAY_SOURCES.md`) and
verify them against the chosen checkpoint:
```
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet \
  --checkpoint-height <N> --checkpoint-hash <H> \
  --archive a.json --crosscheck b.json
```
Expected exit **0**, printing `archive valid <start>..<tip>; crosscheck valid ...; agree over <from>..<to>`.
Exit **1** = `archive refused: <reason>` — a header failed proof of work, linkage, the MTP timestamp
rule, nBits continuity or a recomputed retarget; or the two sources disagree at a height (fork or
faulty source: **wait and re-verify, never pick one**).
Keep: `a.json`, `b.json`, and the printed ranges.

**B4.** Write `outpoints.development`, `outpoints['held-out']` (as `<txid>:<vout>`) and
`checkpoint.{height,hash}` into `reg.json`.

---

## Phase C — the registration itself (§5.5.1; human act)

**C1.** The accountable identity submits the completed record to **OSF Registries**, **public**, **no
embargo**. HUMAN: H2, and H3 for the independence of the accountable identity. An agent may prepare
the record; only the human may submit it.
Keep: the submission itself, the public URL, and the record as submitted.

**C2.** Write the registry-issued `registration_id` and `registration_timestamp`
(`YYYY-MM-DDTHH:MM:SSZ`) into `reg.json`. **Never assert these values** — they come from OSF.

**C3.** Export the accountable identity's full registration listing for `CPG-U1-2026-01` as
`identity_regs.json` (§21 step 1). HUMAN: H1.

**C4.** Verify the registration is complete and authoritative.
```
REG="--registration reg.json --identity-registrations identity_regs.json --protocol CPG_U1_PROTOCOL_004.md"
node cpg_u1_data.mjs verify-registration $REG --registry rules/development_only_registry.json
```
Expected exit **0**, printing
`registration <id> complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match`.
Exit **4** (BLOCKED) = a named prerequisite is still `UNASSIGNED` — the command lists each as
`BLOCKED <field> is UNASSIGNED (...)`. Exit **1** = an ERROR: a pinned value altered, or
`VERIFY_ABORT_HASH_MISMATCH` (the protocol, tooling aggregate or registry file in use is not the
registered one). Exit **6** = `STUDY_VOID_REGISTRATION` from the authority check — an earlier or
differing duplicate registration, or a withdrawal.
**This is the command that currently exits 4 on the ten named prerequisites.** Getting it to exit 0
is the definition of "registered".
Keep: the full stdout/stderr as the registration verification record.

**C5.** Verify the funding outputs against the registered checkpoint (needs the Phase-D bundle, so
run it again after D1):
```
node cpg_u1_data.mjs verify-registration $REG --registry rules/development_only_registry.json --evidence ev.json
```
Expected exit **0**, additionally printing `funding outputs verified against the registered checkpoint`.
Exit **6** if `STUDY_VOID_REGISTRATION` (an outpoint is not P2WPKH, or funding has fewer than 6
confirmations at the checkpoint) or `STUDY_VOID_PRE_REGISTRATION_SPEND` (an outpoint was spent at or
before the checkpoint).

---

## Phase D — frame, evidence bundle, development commitment

**D1. Assemble the sampling-evidence bundle** (assembled offline; it fetches nothing):
```
node cpg_u1_data.mjs sampling-evidence-bundle $REG \
  --headers a.json --headers-crosscheck b.json \
  --funding-development fd.json --funding-held-out fh.json \
  --drand-chain-info info.json [--drand-beacons r1.json,r2.json] \
  --out ev.json
```
Expected exit **0**; it prints one line per stage (`development <STATE>: <reason>`) and
`evidence bundle written (evidence_sha256 <sha>)`. At this point both stages should read
`NOT_STARTED`. Exit **1** = `EVIDENCE_BUNDLE_REFUSED` (a malformed part, or the two archives name the
same source) or `VERIFY_ABORT_EVIDENCE`.
Keep: `ev.json` and its `evidence_sha256`.

**D2. Only now construct the frame** (§5.5.1 ordering — see §0.1):
```
node cpg_u1_data.mjs frame --frame F.csv
node cpg_u1_data.mjs scan --frame F.csv --repo <clean clone> --expect-sha <resolver SHA> \
  --registry rules/development_only_registry.json --out scan.json
node cpg_u1_data.mjs check-frame-sufficiency ...   # §5.7.2
```
`frame` exits **1** on any malformed row. `scan` refuses a repo whose HEAD is not `--expect-sha` or
that has working-tree changes. Keep: `F.csv` and its `frame_hash`, `scan.json` and its `scan_sha256`.

**D3. Build the development commitment payload:**
```
node cpg_u1_data.mjs commitment-payload --stage development $REG \
  --frame F.csv --scan scan.json --registry rules/development_only_registry.json \
  --out payload_dev.json
```
Expected exit **0**, printing `payload_digest: <64 hex>`, `op_return_script: <82 hex chars>` and
`Spend ONLY <outpoint>, with exactly this one OP_RETURN output. The tooling creates no transaction.`
Exit **1** with `FRAME_INSUFFICIENT` means no development commitment may be made.
Keep: `payload_dev.json`, the digest, and the exact `op_return_script` hex.

**D4. Broadcast the development commitment** — external, human, irreversible. See
`BITCOIN_RANDOMNESS_RUNBOOK.md` §3. Spend **only** `O_dev`, **exactly one** OP_RETURN, exactly the
script from D3.

**D5. Wait, re-bundle, and verify:**
```
node cpg_u1_data.mjs verify-commitment $REG --evidence ev.json --stage development
node cpg_u1_data.mjs verify-sampling  $REG --evidence ev.json --stage development
```
`verify-commitment` exits **0** once the commitment is valid and confirmed ≥ 6, printing the current
sampling state. `verify-sampling` prints the stage record as JSON and exits **0** only in `FINAL`;
**5** for any `WAITING_*` / `NOT_STARTED`; **6** for any `STUDY_VOID_*` / `STAGE_VOID_*` /
`STUDY_ABANDONED`; **1** on `VERIFY_ABORT_EVIDENCE`.
Keep: every `verify-sampling` JSON record, with the `evidence_sha256` it was computed from.

**D6. Record the derivation once the stage is FINAL:**
```
node cpg_u1_data.mjs derive-seed $REG --evidence ev.json --stage development
```
Expected exit **0**, printing the full `derivation:` string, `seed_fingerprint: <64 hex>` and
`The seed itself is not printed; the draw commands recompute it internally.` Exit is the state exit
(5 or 6) if the stage is not FINAL — then no seed exists.
Keep: the derivation string and the `seed_fingerprint`. **There is no `--seed` argument anywhere.**

**D7.** `draw-development` → pilot + instrument check (§8.5) → `size` → `pool-check` →
`commitment-payload --stage held-out` → broadcast `O_ho` after development finality → repeat D5/D6
for `held-out` with `--prior-final` set to the published development record. These stages are out of
this stream's scope; the commands are in the instrument's README.

---

## Ongoing rules

- **Write-once outputs.** Every output file is write-once and a refused command writes nothing. To
  redo a step, move the old output aside deliberately and record that you did.
- **Chain clocks only.** All windows are measured by Bitcoin median-time-past, never by the
  operator's wall clock.
- **`--prior-final`.** Once a stage has been recorded FINAL, pass that record as `--prior-final` on
  every later verification. A changed txid, height, block hash or round then reports
  `STUDY_VOID_POST_FINALITY_REORG` (exit 6) instead of silently re-deriving.
- **Never `--allow-synthetic`** outside a deliberate synthetic-test rehearsal on the
  `synthetic-test` network. It is the flag that disables mainnet pinning and the `SYNTHETIC` value
  refusal.
- **Exit-code table (instrument README):** `0` ok · `1` refused / abort · `2` pool below minimum ·
  `3` HALT (zero pilot yield) · `4` BLOCKED (named human prerequisite missing) · `5` WAITING /
  NOT_STARTED · `6` VOID / ABANDONED.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

