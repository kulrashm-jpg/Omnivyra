# CPG-U1 DETERMINISTIC EXECUTION PACKAGING

**Stream:** DEEPTECH-PARALLEL-004 / stream D
**Classification:** ENGINEERING ARTIFACT. It describes how an outsider would reproduce an execution from a
published archive. **No execution has occurred and no archive has been published**, so everything here is a
specification read off the code, not a report of a reproduction. An adapter-conformance pass is an ENGINEERING
ARTIFACT, never U1 evidence and never independent validation.
**Base:** `C:/tmp/dt4-exec` at `af2fb6e99ce461894bf16f18c2251f75088eba18`.
Registered tooling aggregate `<NEW_AGG>` (<NEW_N> files),
unchanged. Nothing under `research/cpg-u1/**` was modified.

---

## 1. What "reproduce" can mean, in four distinct strengths

§13.3 and §14 draw the lines; this document only makes them operational. Conflating these four is the main way a
reader could be misled, so they are named separately.

| Strength | Claim | Possible offline? | Who needs what |
|---|---|---|---|
| **A. Re-score** | The labels and every endpoint follow from the archived CPG responses plus the sealed reference truth | **Yes** | The published archive + the sealed reference file. No clone, no network, no tooling beyond `evaluation-items` / `verify-evaluation` |
| **B. Replay (R1)** | Given the recorded evidence, the resolver emits the archived response — resolver determinism | **Yes** | A clone at the evaluation tree with dependencies installed, plus the archive. `replay-archive` |
| **C. Independent re-derivation of evidence** | The sources really returned the archived bytes | **Yes for first-party and registry evidence** (raw bytes and headers archived). **No for Wikidata** | Raw bytes from the archive; for Wikidata, nothing — see §4 |
| **D. Live re-execution matching byte-for-byte** | A later live run reproduces the archive | **No, and it never will** | Live sources drift. **A live re-run that differs is not a failed replication** and must never be described as one (§13.3, §20.5) |

An outsider reproducing an execution is doing **A** and **B**. Only **B** needs the clone.

---

## 2. The replay path, exactly

The archive is one JSON record per company, at `<archive-dir>/<run-id>/<candidate_id>.json`
(`lib/harness.mjs:100-101`), schema `cpg-u1-response-archive/v1` (`lib/archive.mjs:10`).

**Step 1 — integrity, before anything is run.** `verify-archive-record --record <file>`
(`cpg_u1_data.mjs:831-835` → `lib/archive.mjs:43-65`) recomputes:
`record_sha256` over the canonical record body · `raw_response_sha256` against `raw_response` ·
`canonical_response` really being the canonical form of `raw_response` · `canonical_response_sha256` ·
`text_sha256` for every recorded fetcher exchange · `body_sha256` **and** `body_bytes` and canonical base64 for
every captured HTTP document · ISO-8601 timestamps · `stage`/`run_kind` consistency.
**Integrity is established by this check, not by replay.** A tampered archive still replays — `adapter_conformance.mjs`
assertion 16 proves exactly that, deliberately. An outsider who replays without verifying first has proved nothing.

**Step 2 — the Merkle root.** `archive-merkle-root --archive-dir <run dir>`
(`cpg_u1_data.mjs:875-882` → `lib/archive.mjs:103-120`): RFC 6962 §2.1 tree (leaf prefix `0x00`, node prefix
`0x01`, split at the largest power of two below *n*), leaves = the 32-byte `body_sha256` of every captured HTTP
document, ordered by `candidate_id` then `seq`. It must equal the root published in §13.2 and recorded on the
`RUN_COMPLETED` event. Documents are **HTTP response bodies only**: a Wikidata snapshot contributes **no** leaf
(proven by `wikidata_snapshot_conformance.mjs`, the assertion that `document_count === 0` for a
snapshot-only record).

**Step 3 — replay.** `replay-archive --record <file>` with `CPG_U1_RESOLVER_CLONE` set
(`cpg_u1_data.mjs:838-849`). It re-verifies integrity, then runs the frozen resolver in a child process under the
clone's own `tsx` (`lib/cpgExecutor.mjs:29-37,51-53`) with the recorded evidence injected instead of the network
(`harness/cpgAdapter.ts:81-102`):

- a fetch is answered from the archive by **`(requested_url, occurrence)`**; a recorded `error` is re-thrown as an
  error, so failure paths replay as failures too (`:87-92`);
- a Wikidata call is answered by **`(brand_name, occurrence)`** (`:93-98`);
- **a request not in the archive is a `miss`, never a refetch** (`:89,:95`) — replay cannot touch the network even
  if the archive is incomplete;
- leftover unconsumed entries are counted as `unused` (`:100`).

The command **fails** on any miss (`REPLAY_MISS`) and on any difference (`REPLAY_DIFFERS`). The verdict is
canonical-JSON equality of the replayed response against the archived `canonical_response`
(`lib/archive.mjs:69-74`) — not a field-by-field comparison, and not a similarity score.

**Step 4 — the event log.** `verify-event-log --log <file> --authorization <file>`
(`cpg_u1_data.mjs:816-834`). The chain detects an edited, reordered or deleted interior event
(`lib/eventlog.mjs:22-37`). The audit derived from those events (`lib/harness.mjs:203-215` →
`lib/execution.mjs:101-155`) returns `NO_VIOLATION_IN_LOG`, `NOT_EXECUTED`, or one of
`STUDY_VOID_PREVIEW` / `STUDY_VOID_UNAUTHORIZED_EXECUTION` / `STUDY_VOID_REPEATED_EXECUTION` /
`STUDY_VOID_POST_WINDOW_EXECUTION`.
**Two limits an outsider must hold on to:** a truncated **tail** or a wholly substituted log is **not** detectable
from the file alone — the head hash has to have been published (`lib/eventlog.mjs:1-4`); and the audit examines
**only the supplied log**, whose timestamps come from the operator's systems (§6.5, §20.20).

**Step 5 — re-score.** `evaluation-items` then `verify-evaluation`, which **rebuilds** the evaluation artifact
byte-for-byte from the archive, event log, seal, authorisation and reference and refuses on any difference
(`cpg_u1_data.mjs:900-913`). Cited URLs come from one fixed rule,
`cpg-u1-cited-urls/field-evidence-union/v1` — the ordered, deduplicated union of the `sourceUrl`s in a field's
evidence records (§12.3 Rule A). `adapter_conformance.mjs` assertions 9–10 prove the rule against the **real**
response shape the frozen resolver emits, not against a fixture.

---

## 3. What is byte-reproducible

| Reproducible byte-for-byte | Why, and what proves it |
|---|---|
| The **canonical CPG response** from the archived evidence | `compareReplay` requires canonical-JSON equality. `adapter_conformance.mjs` assertion 13 (byte-identical) and 14 (identical again on a second replay); `wikidata_snapshot_conformance.mjs` assertion 12 for a Wikidata-derived response |
| Every **record hash and the archive Merkle root** | Pure functions of the archive bytes (`lib/archive.mjs:39,103-120`) |
| The **evaluation artifact** | Rebuilt and compared byte-for-byte (`verify-evaluation`) |
| The **raw bytes of every first-party, identity and registry HTTP response**, with status and headers incl. `Date`/`Last-Modified` | Captured on undici's diagnostics channels as undici delivered them to the consumer, **before** any content decoding `fetch` performs (`harness/cpgAdapter.ts:6-9,30-45`). `adapter_conformance.mjs` assertions 3–5, including non-UTF-8 bytes |
| The **sampling draw** | `verify-sampling` recomputes commitments, finality, rounds, seeds and draws from the §13.2A archive (§13.3 row 5) |
| The **treatment identity** | `verify-evaluation-tree` recomputes commit, tree object and content-manifest aggregate; differing *content* is refused, a differing *commit id over identical content* is reported and accepted, and a clone whose tracked files include the instrument is refused as a conflation of treatment with instrument (§7.1; `cpg_u1_data.mjs:863-873`). Observed in the self-test run: `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`, 11552 files |

## 4. What is **not** byte-reproducible, stated without hedging

1. **A live re-execution.** Live sources drift: pages change, registries update, `Date` headers move, availability
   changes. A live re-run that differs from the archive is **not** a failed replication (§13.3 last row, §20.5).
   Anyone reporting a live diff as a replication failure is misreading the protocol.
2. **That Wikidata returned the recorded values.** The adapter calls global `fetch` directly
   (`backend/services/intelligence/adapters/wikidataAdapter.ts:65`, endpoints `:23-24`) and is **not** routed
   through the injected fetcher; §7's STRUCTURAL note and §13.3 both record this. Only the adapter's **output** is
   archived (`harness/cpgAdapter.ts:58-68`): input label, returned object, timestamps. Wikidata-derived claims are
   therefore **replayable but not independently re-derivable**, and an outsider trusts the operator's recording
   wrapper for that one link. This is §20.4 and it is a limitation on Wikidata-derived fields specifically.
   *A caveat that must not be over-read:* because the raw-body capture is on undici's diagnostics channels rather
   than on the injected fetcher, it also observes the adapter's own bundled-`fetch` calls
   (`adapter_conformance.mjs` assertion 5 proves byte-exact capture for a bundled-`fetch` body). So wikidata.org
   bytes would in fact appear among `http_events` in a real run. **This does not upgrade the claim**: no
   `http_event` is linked to any `wikidata_call`; replay reads only `exchanges` and `wikidata_calls`
   (`harness/cpgAdapter.ts:81-98`); no registered tool re-derives an adapter output from those bytes; and capture
   over TLS to the real endpoint is **UNVERIFIED** here, because no network call was made in this stream.
3. **Wall-clock timings.** `started_at`/`completed_at` on the record, the exchanges, the HTTP events and the log
   events are observations, not inputs. They differ on replay by construction and are outside the equality check.
4. **The `undici` version and the Node version.** They are *recorded* in `executor` (`lib/cpgExecutor.mjs:41-43`)
   but not *enforced*: nothing refuses a replay under a different Node. An outsider should replay on the recorded
   `node_version` and `undici_version` if a diff appears.
5. **Absence of an unlogged private query.** No packaging can establish it (§6.5, §20.20). It is procedural — the
   signed no-preview declaration, restricted access — and audit-based — stored-lookup exports made where possible
   by someone other than the operator.
6. **Independence of the two Bitcoin header sources, and relay count.** The bundle requires two *differently named*
   archives and cross-checks them block-for-block (`lib/evidenceBundle.mjs:49-51`, `lib/bitcoin.mjs:170-182`), but
   names are not proof of independence; and the bundle accepts a **single** drand beacon — nothing enforces the
   §19.3 minimum of two relays (`lib/evidenceBundle.mjs:31-40`). Beacon *authenticity* is cryptographic (BLS against
   the pinned quicknet public key, `randomness == sha256(signature)`, `lib/drand.mjs:88-98`), so one relay cannot
   forge; what ≥ 2 relays guard against is withholding or misreporting. Outsiders confirm with a full node and
   ≥ 2 relays themselves (§20.17, §21).

---

## 5. Environment pinning the harness enforces

Pinning is enforced at three layers, and each one refuses rather than warns.

**Layer 1 — the resolver clone** (`cpg_u1_data.mjs:753-757`, refused at `lib/harness.mjs:52-54`):

| Pin | Check | Refusal |
|---|---|---|
| **Resolver SHA** | `git rev-parse HEAD` == the manifest's `resolver_sha` | `RESOLVER_MISMATCH` |
| **Clean tree** | `git status --porcelain` is empty | `RESOLVER_MISMATCH` (same code — an uncommitted edit is as fatal as the wrong commit) |
| **No `.env*` files** | `readdirSync(clone).filter(f => /^\.env/.test(f) && !f.endsWith('.example'))` is empty | `RESOLVER_ENV_FILES` — *the evidence environment must hold no credentials* |
| **Provider configuration hash** | domain-separated SHA-256 over `grounding/registry/builtins.ts` + `grounding/registry/coverageInventory.ts`, in that order (`lib/harness.mjs:17-23`) == the registered `provider_configuration_sha256` | `PROVIDER_CONFIG_MISMATCH` |

**Layer 2 — the child process environment** (`lib/cpgExecutor.mjs:15-21`). The child receives **only**:
the operating-system variables needed to start a process — `PATH`/`Path`, `PATHEXT`, `SystemRoot`/`SYSTEMROOT`,
`windir`/`WINDIR`, `ComSpec`/`COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` —
plus **`CACHE_KILL_ALL=1`** plus `CPG_U1_RESOLVER_CLONE`. Nothing else from the operator's shell: no credential, no
rollout override, no cache override, no `WIKIDATA_ENABLED`, no `WIKIDATA_CACHE_TTL_SECONDS`. Every other resolver
behaviour is the code default at the frozen SHA.

- **Proven**, not asserted: `adapter_conformance.mjs` assertion 11 sets `CPG_U1_CONFORMANCE_SENTINEL` in the parent
  and proves it does not appear in the child's `process.env`, while `CACHE_KILL_ALL` does.
- `CACHE_KILL_ALL=1` is truthy under `lib/platform/cacheCore.ts:80-93`, so **every** namespace is bypassed —
  including the Wikidata adapter's (`wikidataAdapter.ts:201-209`). This is how §13.1's "the harness must run it
  cold" is met mechanically rather than by convention.
- Because `WIKIDATA_ENABLED` is absent, Wikidata is enabled by the adapter's own default
  (`wikidataAdapter.ts:225,261`) — by code, not by an operator switch.
- The whole pinned environment, the adapter's own SHA-256, the resolver SHA, the Node version, the installed
  `undici` version and the bundled `undici` version are recorded in `executor` on **every** archive record
  (`lib/cpgExecutor.mjs:41-43`).

**Layer 3 — the study bindings** (`lib/harness.mjs:36-58`, `152-181`). Protocol SHA, **tooling aggregate**,
registry SHA, frame hash, scan SHA, both manifests' bindings, both sampling records recomputed from the
chain-verified evidence, the seal, its publication and the authorisation — the last **rebuilt from the sealed
artifacts and compared, never trusted** (`AUTHORIZATION_MISMATCH`). `TOOLING_MISMATCH` means the instrument itself
is pinned: **any byte changed anywhere in the <NEW_N> tooling files moves the aggregate and refuses the run.** That is
why a gap in the tooling cannot be fixed by editing the tooling once registration has happened.

---

## 6. The outsider's minimum kit

1. The published **protocol file** (SHA-256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`
   for protocol-004) and the **registration record**.
2. The published **tooling** — it must hash to the registered aggregate, or `TOOLING_MISMATCH`.
3. A **clone at the evaluation tree**: commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, tree
   `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, content aggregate
   `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files), with
   `npm ci --ignore-scripts` run and **no `.env*` file**. §7.1: if the commit ever becomes unreachable, **the
   content aggregate, not the commit id, is what the study was run against.**
4. The **response archive** (`<run-id>/<candidate_id>.json` per company), the **event log with its published head
   hash**, the **archive Merkle root**, the **authorisation**, the **seal** and its publication record, and the
   **sealed reference file**.
5. The **sampling archive** (§13.2A) for the draw, plus — for step 6 of §21 — their **own** Bitcoin full node and
   **≥ 2 drand relays**. The tooling cannot prove non-spend, most-work status, source independence or drand
   unavailability from a bundle (§20.17).
6. **No network access is needed for A or B.** Replay refuses to fetch: a missing exchange is a miss, not a
   refetch.

**Current status of that kit: it does not exist.** Nothing has been registered, funded, executed or published, so
no outsider can do any of this today. Everything above is a specification read off the code, plus the three
ENGINEERING ARTIFACT test runs recorded in `EXECUTION_READINESS.md` §7 (18/18, 1022/1022, 15/15).

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

