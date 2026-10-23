# CPG-U1 EXECUTION READINESS

**Stream:** DEEPTECH-PARALLEL-004 / stream D (CPG-U1 execution infrastructure)
**Classification of this document:** ENGINEERING ARTIFACT (an assessment of the instrument). It is **not** U1
evidence, **not** registered evidence, and **not** independent validation. Nothing in it reports a U1 result,
because no U1 execution has occurred.
**Base:** worktree `C:/tmp/dt4-exec` at `af2fb6e99ce461894bf16f18c2251f75088eba18` (detached, clean).
**Nothing under `research/cpg-u1/**` was modified.** The registered tooling aggregate is unchanged
(`<NEW_AGG>`, <NEW_N> files, recomputed after every run below).

---

## 0. What "verified" means here, and what it does not

An adapter-conformance pass is an **ENGINEERING ARTIFACT**. It proves that the instrument records, archives and
replays what it claims to record, archive and replay, against the real frozen resolver, offline, on synthetic
companies. It is **never U1 evidence** and **never independent validation**: the instrument was written by the
developing organisation, the test was written by the developing organisation, and no company in the study frame
was touched. Reading a conformance pass as "CPG works" or as "the study is replicable" would be a category error.

Vocabulary used below: **EXISTS+VERIFIED** (code exists and a test I actually ran proves the behaviour the protocol
needs) · **EXISTS+UNVERIFIED** (code exists; no test exercises the protocol-relevant behaviour) · **PARTIAL**
(the mechanism exists but does not cover the whole of what the protocol names) · **ABSENT**.

---

## 1. §19.3 execution prerequisites — true state

| # | §19.3 prerequisite | State | Evidence (file:lines) | The test that proves it |
|---|---|---|---|---|
| 1 | **Recording fetcher** | **EXISTS+VERIFIED** | Wrapper `research/cpg-u1/tooling/harness/cpgAdapter.ts:46-57`; raw-body + header capture off undici's diagnostics channels `:30-45`, `:38-44`; production fetcher injected unchanged at `:113,115` (`createSafeEvidenceFetcher({ budgetMs: 45_000 })`); per-process bridge `lib/cpgExecutor.mjs:29-45` | `test/adapter_conformance.mjs` — **18 passed, 0 failed** (run below). Assertions 2–5 cover every exchange captured, `Date`/`Last-Modified` from the diagnostics channel, byte-exact undici body + SHA-256, and byte-exact Node-bundled-fetch body including non-UTF-8 bytes |
| 2 | **Recording Wikidata lookup** | **EXISTS+VERIFIED** for the §13.1 snapshot and §13.3 replay round trip — **newly proven by this stream**; **PARTIAL by design** against raw-HTTP archival (§13.3 declares it; see §2) | Record `harness/cpgAdapter.ts:58-68`; snapshot shape `:21`; replay answer-from-archive `:93-98`; production adapter injected unchanged at `:114,115`; archived under `replay.wikidata_calls` (`lib/archive.mjs:37`) | **Was EXISTS+UNVERIFIED before this stream.** `test/adapter_conformance.mjs:52` injects `async (name) => null`, so the Wikidata source only ever took its throw path; `test/selftest.mjs:940` and `:1870` build records with `wikidata_calls: []`. Closed by `wikidata_snapshot_conformance.mjs` (this directory) — **15 passed, 0 failed**, with a mutation check that kills 2 assertions |
| 3 | **Replay harness** | **EXISTS+VERIFIED** | `harness/cpgAdapter.ts:81-102` (answers by `(requested_url, occurrence)` and `(brand_name, occurrence)`; a request not in the archive is a **miss**, never a refetch, `:89,:95`); bridge `lib/cpgExecutor.mjs:51-53`; verdict `lib/archive.mjs:69-74`; CLI `replay-archive` `cpg_u1_data.mjs:838-849` | `adapter_conformance.mjs` assertions 12–14, 17–18 (byte-identical replay, repeatable, replay-miss on a removed exchange, differing-archive detection) + `wikidata_snapshot_conformance.mjs` assertions 11–15 |
| 4 | **certenv with a fixture tenant** | **ABSENT as named — and not required by the evaluated code path.** The prerequisite it stands in for (a credential-free non-production evidence environment) is **EXISTS+VERIFIED**. See §3 | `FIXTURE_COMPANY_ID = 'CPG-U1-FIXTURE'` `lib/harness.mjs:13`, used only as the `companyId` label in `lib/harness.mjs:32-34`. `companyId` never reaches storage: `companyFactsLookup.ts:106-121` → `acquisition/orchestrator.ts:118` propagates it at `:143,:180,:198` only; `companyFactsLookup.ts:27-33` imports no database client. Repo-wide grep for `CPG-U1-FIXTURE`: 5 hits, all inside `research/cpg-u1/tooling` — **no seed SQL, no migration, no certenv fixture row exists** | The frozen resolver completed a full lookup with `companyId: 'CPG-U1-FIXTURE'` and **no database, no container and no service running** — `adapter_conformance.mjs:49` and `wikidata_snapshot_conformance.mjs`, both passing. What the harness *does* enforce instead: `RESOLVER_MISMATCH` + `RESOLVER_ENV_FILES` (`lib/harness.mjs:52-53`, probe `cpg_u1_data.mjs:753-757`) |
| 5 | **Two independent Bitcoin header sources** | **PARTIAL** — two sources are *structurally required* and *mechanically cross-checked*; their **independence is unprovable by the tooling** (§20.17) | Two differently named archives required: `lib/evidenceBundle.mjs:49-51`. Block-for-block cross-check over the common range, throwing on any disagreement: `lib/bitcoin.mjs:170-182`, invoked `cpg_u1_data.mjs:315`. Archive must start at a retarget boundary ≤ the registered checkpoint and reach it with a matching hash: `lib/bitcoin.mjs:158-167`. CLI inputs `--headers` / `--headers-crosscheck` `cpg_u1_data.mjs:1063`. **The tooling fetches nothing** — a repo grep for `fetch(` / `http` literals across `lib/*.mjs` + `cpg_u1_data.mjs` returns exactly one hit, the constructed `websiteUrl` string at `lib/harness.mjs:33` | `test/selftest.mjs` — **1022 passed, 0 failed** (run below), including historical mainnet fixtures (blocks 836640, 838655–838656, 839989–840012, 840000 Merkle proof; `test/fixtures/PROVENANCE.json`). The **two archives themselves are HUMAN-REQUIRED INPUT and do not exist**. "Differently named" is a name check, not proof of independence |
| 6 | **≥ 2 drand relays** | **PARTIAL — and this is the one genuine mechanical gap in §19.3.** Authenticity is fully cryptographic; the *count* of relays is unenforced | Beacons are deduplicated by round and a disagreement between relays is refused rather than resolved (`lib/evidenceBundle.mjs:31-40`), but **a bundle carrying a single beacon is accepted** — there is no minimum. The round is computed by the tooling, never supplied (`lib/drand.mjs:39-40`), and the beacon for the required round is BLS-verified against the pinned quicknet public key with `randomness == sha256(signature)` (`lib/drand.mjs:88-98`, consumed `lib/sampling.mjs:180-188`) | `test/selftest.mjs` — 1022 passed, 0 failed, over quicknet fixtures (chain info; rounds 1, 1000000, 12345678). **Consequence, stated honestly:** because the signature must verify against the pinned public key, one relay cannot *forge* randomness; what ≥ 2 relays protect against is a relay *withholding* or *misreporting* a round, which the tooling cannot detect from a one-relay bundle. The ≥ 2 requirement is therefore **procedural**, exactly as §20.17 says |

**Also load-bearing and already verified, though not itself a §19.3 line item:** the evaluation-tree pin.
`verify-evaluation-tree` (`cpg_u1_data.mjs:863-873`) recomputed the treatment clone as commit
`f01a7eb4199be4e04d4fee7fc0116303949dc553`, tree `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, content-manifest
aggregate `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files) inside the self-test
run below — the §7.1 declared values, matched.

---

## 2. What the recording Wikidata lookup does and does not archive

**Archived, per call** (`harness/cpgAdapter.ts:58-68`, shape at `:21`, stored at `lib/archive.mjs:37`):
`seq`, `brand_name` (the input label), `result` (the returned object verbatim — `founded_year`, `team_size`,
`revenue_range`, `matched_label`, `qid`, `official_websites`), `error`, `started_at`, `completed_at`. Integrity is
covered by `record_sha256` over the canonical record body (`lib/archive.mjs:39,47`). Newly proven end to end by
`wikidata_snapshot_conformance.mjs`.

**Not archived through the wrapper:** anything about the HTTP exchange. The adapter calls global `fetch` directly
(`backend/services/intelligence/adapters/wikidataAdapter.ts:65`, endpoints `:23-24`) and is **not** routed through
the injected fetcher — §7's STRUCTURAL note and §13.3 both say so, and `wikidataSource.ts:56-57` is the single
injection point the harness uses.

**One thing the protocol under-states, which must not be over-read.** The adapter's raw-body capture is on
undici's diagnostics channels, not on the injected fetcher, so it also sees calls made with Node's bundled
`fetch` — i.e. the Wikidata adapter's own requests. `adapter_conformance.mjs` assertion 5 proves this for a
bundled-`fetch` call, byte-exact including non-UTF-8 bytes. So in a real run `replay.http_events` would in fact
contain wikidata.org request/response bytes. **This does not upgrade §13.3**, for four reasons, and the honest
position is that §13.3 stands:

1. No `http_event` is linked to any `wikidata_call` — there is no relation in the record.
2. Replay never reads `http_events`; `replayLookup` consumes only `exchanges` and `wikidata_calls`
   (`harness/cpgAdapter.ts:81-98`). Wikidata determinism rests on the snapshot, full stop.
3. No tool in the registered instrument re-derives an adapter output from those bytes. Doing so would need an
   adapter change, which §13.3 puts out of scope.
4. It is **UNVERIFIED against the real HTTPS endpoint** — no network call is permitted in this stream, so capture
   over TLS to wikidata.org is asserted by mechanism, not demonstrated.

**Consequence for replication, stated plainly.** Wikidata-derived fills are **replayable** (Rung R1 holds: the
archived snapshot reproduces the canonical response byte-for-byte — proven) but **not independently
re-derivable**: an outsider cannot check that wikidata.org said what the snapshot says it said. For those fields
the outsider trusts the operator's recording wrapper. This is §20.4, and it is a real limitation on
Wikidata-derived claims specifically, not on the whole archive: first-party and registry evidence **is** archived
as raw bytes with headers and is independently checkable (§13.3 row 3; `adapter_conformance.mjs` assertion 4).

---

## 3. The certenv / fixture-tenant position

**`FIXTURE_COMPANY_ID` is a string, not a tenant.** It is `'CPG-U1-FIXTURE'` (`lib/harness.mjs:13`) and the harness
uses it for exactly one purpose: the `companyId` field of the §7 treatment input (`lib/harness.mjs:32-34`). The
evaluated function passes it through `orchestrateGrounding` (`acquisition/orchestrator.ts:118`), which propagates
it into the acquisition context and the resolver calls (`:143,:180,:198`) and never reads or writes storage with
it. `companyFactsLookup.ts` imports no database or Supabase client (`:27-33`). §7 is explicit that the route's
authentication, tenant authorisation and persisted-profile read are out of U1 scope.

**There is no local certenv fixture tenant in this repository.** `CPG-U1-FIXTURE` appears in 5 places repo-wide,
all inside `research/cpg-u1/tooling`. No migration, seed or fixture creates it.

**A certenv does exist in this repository, and it is the wrong thing to stand up.** `package.json` provides
`dev:cert`, `cert:db:build`, `cert:api:up`, `cert:guard`; `scripts/cert/dev-cert.mjs:1-45` loads `.env.cert`,
starts the Docker Supabase stack on :54321/:54322, then Redis + workers + cron + Next. That environment is
**incompatible with the harness by design**: the harness refuses any resolver clone containing a non-example
`.env*` file — `RESOLVER_ENV_FILES` (`lib/harness.mjs:53`), probed at `cpg_u1_data.mjs:756` as
`readdirSync(clone).filter(f => /^\.env/.test(f) && !f.endsWith('.example'))`. Putting `.env.cert` in the clone
would refuse the run. The §7 "non-production evidence environment" is therefore **the dependency-installed clean
clone itself**, executed one child process per company with a pinned environment.

**What the harness actually requires of the environment** (`lib/cpgExecutor.mjs:15-21`, `:23-27`):
operating-system variables only (`PATH`, `PATHEXT`, `SystemRoot`, `windir`, `ComSpec`, `TEMP`/`TMP`/`TMPDIR`,
`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and their case variants), plus `CACHE_KILL_ALL=1`, plus
`CPG_U1_RESOLVER_CLONE`. **No operator shell variable reaches the resolver** — `adapter_conformance.mjs`
assertion 11 sets a sentinel variable and proves it does not arrive. `CACHE_KILL_ALL=1` is truthy under
`lib/platform/cacheCore.ts:80-93`, so every namespace including the Wikidata adapter's
(`wikidataAdapter.ts:201-209`) is bypassed: §13.1's "run it cold" is satisfied mechanically, not by convention.
`WIKIDATA_ENABLED` is absent under the pinned environment, and the adapter's default is enabled
(`wikidataAdapter.ts:225,261`), so Wikidata is on by code default — not by an operator setting.

**What an operator must stand up before the authorised run — the complete list:**

1. A **git clone of the resolver at `f01a7eb4199be4e04d4fee7fc0116303949dc553`**, with **`npm ci --ignore-scripts`**
   run so `node_modules/tsx/dist/cli.mjs` exists (`lib/cpgExecutor.mjs:23-27`), a **clean working tree**
   (`git status --porcelain` empty), and **no `.env*` file** other than `*.example`.
   *Already satisfied by `C:/tmp/cpg049_integration/treatment`: HEAD `f01a7eb4…`, tree `3b4811fc…`, 0 porcelain
   lines, only `.env.beta.example` and `.env.cert.example` present (both excluded by the check).*
2. `CPG_U1_RESOLVER_CLONE` pointing at it.
3. **Outbound network access to the live sources**, because the authorised run is a live execution. Nothing else.
4. **No database. No container. No Redis. No Next.js. No certenv. No credentials.** Standing any of these up is
   not required and — for `.env.cert` inside the clone — actively harmful.
5. A writable, **empty** archive directory (the run directory is write-once, `lib/harness.mjs:93,138,181`) and an
   event-log path.

**Change request (cannot be fixed here).** §19.3 names "certenv with a fixture tenant" as an execution
prerequisite. On the evidence above it names something that does not exist, is not needed, and whose literal
construction inside the resolver clone would be refused by the harness. The accurate prerequisite is "a clean,
dependency-installed, credential-free clone at the evaluation tree, plus the non-production fixture `companyId`
label". **File:** `research/cpg-u1/CPG_U1_PROTOCOL_004.md`, §19.3 final paragraph. **I did not edit it.**
Aggregate impact: the protocol file's SHA-256 is `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`
and is bound by `protocol_sha256` in the registration, the manifests and the authorisation; changing one byte
changes all of them and requires a new protocol version as a new file (§6.2). **Because the divergence is in
wording and not in behaviour, it is a registration-readiness item, not a blocker on the instrument.**

---

## 4. The single authorised held-out run — exact ordered command sequence

Every command runs from `research/cpg-u1/tooling`, with `CPG_U1_RESOLVER_CLONE` exported. All of it is
**PREPARATION** until step 4, which is the only **EXECUTION EVIDENCE**-producing step. `CPG_U1_HARNESS_NOW` and
`--synthetic-executor` are refused outside a `synthetic-test` registration (`cpg_u1_data.mjs:746-750,760-765`) and
must not appear.

```bash
export CPG_U1_RESOLVER_CLONE=/path/to/clone-at-f01a7eb4     # clean, deps installed, no .env*

# ── 1. Development pilot (§6.3, §11). Repeatable. Development companies only. ──
node cpg_u1_data.mjs harness-pilot \
  --registration reg.json --identity-registrations identity-registrations.json \
  --protocol ../CPG_U1_PROTOCOL_004.md --registry rules/development_only_registry.json \
  --frame frame.csv --scan scan.json \
  --dev-manifest development-manifest.json --evidence sampling-evidence.json \
  --run-id pilot-1 --candidates DEV-001,DEV-002,... \
  --log harness-events.jsonl --archive-dir archive
node cpg_u1_data.mjs pilot-result --archive-dir archive/pilot-1 \
  --dev-manifest development-manifest.json --out pilot-result.json

#    → sizing, held-out draw, reference adjudication, reconciliation, seal
#    → publish the seal record on OSF and capture its registry-issued timestamp
#    (HUMAN-REQUIRED INPUT; none of it is in this stream's scope)

# ── 2. Authorisation (§6.5). After the seal is published, before any held-out execution. ──
node cpg_u1_data.mjs authorize-execution \
  --registration reg.json --seal seal.json --seal-publication seal-publication.json \
  --dev-manifest development-manifest.json --held-out-manifest held-out-manifest.json \
  --frame frame.csv --out authorization.json

# ── 3. Pre-flight, changing nothing ──
node cpg_u1_data.mjs verify-evaluation-tree --repo "$CPG_U1_RESOLVER_CLONE" \
  --protocol ../CPG_U1_PROTOCOL_004.md
node cpg_u1_data.mjs verify-event-log --log harness-events.jsonl --authorization authorization.json

# ── 4. THE SINGLE AUTHORISED RUN (§6.5). Once. No restart. No resumption. ──
node cpg_u1_data.mjs harness-held-out \
  --registration reg.json --identity-registrations identity-registrations.json \
  --protocol ../CPG_U1_PROTOCOL_004.md --registry rules/development_only_registry.json \
  --frame frame.csv --scan scan.json \
  --dev-manifest development-manifest.json --held-out-manifest held-out-manifest.json \
  --evidence sampling-evidence.json \
  --seal seal.json --seal-publication seal-publication.json --authorization authorization.json \
  --run-id ho-1 --log harness-events.jsonl --archive-dir archive
#   --candidates is OMITTED: the authorised set is taken from the held-out manifest
#   (cpg_u1_data.mjs:801) and must equal authorization.held_out_candidate_ids exactly.
#   If this run is interrupted: harness-close-interrupted --log … --authorization … .
#   It executes NOTHING; unexecuted companies are INVALID (§15.2). There is no resumption.

# ── 5. Post-run verification ──
node cpg_u1_data.mjs verify-event-log --log harness-events.jsonl --authorization authorization.json
node cpg_u1_data.mjs archive-merkle-root --archive-dir archive/ho-1
node cpg_u1_data.mjs replay-archive --record archive/ho-1/<CANDIDATE>.json    # per record

# ── 6. Evaluation (after the reference file is sealed) ──
node cpg_u1_data.mjs evaluation-items \
  --seal seal.json --held-out-manifest held-out-manifest.json --reference reference-reconciled.csv \
  --authorization authorization.json --log harness-events.jsonl --archive-dir archive/ho-1 \
  --out evaluation.json
node cpg_u1_data.mjs verify-evaluation \
  --seal seal.json --held-out-manifest held-out-manifest.json --reference reference-reconciled.csv \
  --authorization authorization.json --log harness-events.jsonl --archive-dir archive/ho-1 \
  --evaluation evaluation.json
```

`evaluation-items` and `verify-evaluation` are **ANALYTICAL RESULT** producers over EXECUTION EVIDENCE;
`verify-evaluation` rebuilds the artifact byte-for-byte from the archive, event log, seal, authorisation and
reference and refuses on any difference (`cpg_u1_data.mjs:900-913`).

---

## 5. Fail-closed refusals applied before anything executes

Every attempt — executed or refused — appends exactly one hash-chained event (`lib/eventlog.mjs:41-47`), and a
broken log means the refusal happens anyway and is reported as **unlogged** (`lib/harness.mjs:122-123`). The log's
chain detects an edited, reordered or deleted interior event; a truncated **tail** or a wholly substituted log is
**not** detectable from the file alone and needs the head hash published (`lib/eventlog.mjs:1-4`).

**Request shape** (`lib/harness.mjs:80-88`) — `MALFORMED_EXECUTION`:
`REQUEST_MISSING` · `RUN_ID_INVALID` · `CANDIDATES_INVALID` · `CANDIDATES_DUPLICATE` · `CANDIDATE_NOT_IN_FRAME`.

**Common to pilot and held-out** (`lib/harness.mjs:36-58`), all `VERIFICATION_FAILURE` unless noted:
`REGISTRATION_INVALID` (:39) · `AUTHORITY_INVALID` (:41) · `STUDY_VOID_REGISTRATION` (:42) ·
`PROTOCOL_MISMATCH` (:43) · `TOOLING_MISMATCH` (:44 — *this tooling is not the registered tooling*) ·
`REGISTRY_MISMATCH` (:45) · `MANIFEST_INVALID` (:47) · `STUDY_MISMATCH` (:48) · `MANIFEST_BINDING_MISMATCH` (:49) ·
`FRAME_MISMATCH` (:50) · `SCAN_MISMATCH` (:51) · **`RESOLVER_MISMATCH`** (:52 — head ≠ the manifest's
`resolver_sha`, **or the tree is not clean**) · **`RESOLVER_ENV_FILES`** (:53 — the clone holds a non-example
`.env*`; the evidence environment must hold no credentials) · `PROVIDER_CONFIG_MISMATCH` (:54) ·
`SAMPLING_RECORD_MISMATCH` (:56) · `EVIDENCE_INVALID` (:63) · `STUDY_VOID` (:66 — the sampling event is in a
`STUDY_*`/`STAGE_*` state) · `COMMITMENT_NOT_FINAL` (:67 — commitment, confirmations, randomness or drand not yet
verifiable) · `EVENT_LOG_BROKEN` (:111) · `ARCHIVE_EXISTS` (:93,138,181 — the run directory is **write-once**).

**Pilot only:** `PREVIEW_ATTEMPT` / `NON_DEVELOPMENT_COMPANY` (:137) — the pilot may execute development
companies and nothing else.

**Held-out only** (`lib/harness.mjs:152-181`): the four held-out manifest bindings repeated for the held-out
manifest (:153-157) and its `SAMPLING_RECORD_MISMATCH` (:159), then
`AUTHORIZATION_MISSING` (:161) · `AUTHORIZATION_ALTERED` (:163 — the hash does not recompute) ·
`AUTHORIZATION_UNBUILDABLE` (:167) · **`AUTHORIZATION_MISMATCH`** (:168 — the supplied authorisation is not the
one *derived* from the sealed artifacts; it is rebuilt, never trusted) ·
**`WINDOW_NOT_OPEN`** (:174-176 — logged as `PREVIEW_ATTEMPT` when any requested id is a held-out id, otherwise
`EXECUTION_REFUSED`) · **`POST_WINDOW_EXECUTION` / `WINDOW_CLOSED`** (:177) ·
**`REPEATED_EXECUTION` / `RESTART_REFUSED`** (:178 — no restart, resumption or repetition) ·
`MALFORMED_EXECUTION` / `CANDIDATES_NOT_AUTHORIZED_SET` (:179 — exactly the authorised set, each once).

Authorisation construction itself refuses before any of this: a seal hash that does not recompute, a seal that does
not bind these manifests or these sampling records, differing development/held-out frames or scans, a supplied
frame that is not the sealed frame, a publication naming another seal hash, and a seal published **before** the
held-out drand round could exist (`lib/execution.mjs:40-83`).

**What none of this can do** (`lib/harness.mjs:1-3`, §6.5, §20.20): prevent or prove the absence of a CPG query
made **outside** the harness. `audit-execution-log` audits **the supplied log only**, whose timestamps come from
the operator's systems. Protection against an unlogged private query is procedural (the signed no-preview
declaration, restricted access) and audit-based (stored-lookup exports made where possible by someone other than
the operator).

---

## 6. What must be archived per §13.1, and where it lands

| §13.1 component | Where the harness puts it | Integrity |
|---|---|---|
| **Raw documents** — URL, final URL, status, response headers incl. `Date`/`Last-Modified`, body bytes, retrieval timestamp; per-document SHA-256 **plus a Merkle root** | `replay.http_events[]` (`harness/cpgAdapter.ts:22,30-45`), written to `<archive-dir>/<run-id>/<candidate_id>.json` (`lib/harness.mjs:100-101`) | `body_sha256` + `body_bytes` per document (`lib/archive.mjs:58-62`); RFC 6962 tree over the body hashes, leaves ordered by `candidate_id` then `seq` (`lib/archive.mjs:103-120`); root recorded on the run-completion event (`lib/harness.mjs:184`) |
| **Wikidata adapter snapshots** — input label, returned object, timestamp; *evidence snapshots, not raw HTTP* | `replay.wikidata_calls[]` (`harness/cpgAdapter.ts:58-68`; `lib/archive.mjs:37`) | `record_sha256` over the canonical body (`lib/archive.mjs:39,47`). **Newly proven** by `wikidata_snapshot_conformance.mjs` |
| **Adapter cache state** — run cold, or record every hit as such | Run cold: `CACHE_KILL_ALL=1` in the pinned child environment (`lib/cpgExecutor.mjs:16,20`), disabling every namespace (`lib/platform/cacheCore.ts:92`) | `adapter_conformance.mjs` assertion 11 asserts `cache_kill_all === '1'` inside the child; the pinned environment is recorded in `executor.environment` (`lib/cpgExecutor.mjs:42-43`) |
| **CPG responses** — the complete `lookupGroundedCompanyFacts` response per company | `raw_response` **and** its canonical form `canonical_response` (`lib/archive.mjs:27-38`) | `raw_response_sha256`, `canonical_response_sha256`, and a check that the canonical form really is the canonical form of the raw bytes (`lib/archive.mjs:48-53`) |
| **Run metadata** — run id, `asOf`, resolver SHA, provider configuration hash, wall-clock start and end, published seal hash | `RUN_STARTED` event (`lib/harness.mjs:72,182`); end = the `RUN_COMPLETED` event time (`:184`) | Hash-chained event log (`lib/eventlog.mjs:22-47`); provider config hash = domain-separated hash over `registry/builtins.ts` + `registry/coverageInventory.ts` (`lib/harness.mjs:17-23`) |
| **§6.5 additions** — authorisation, execution log, `audit-execution-log` output, signed no-preview declaration, stored-lookup exports | Authorisation from step 2; the execution log is **derived** from the harness events (`lib/harness.mjs:203-215`); the declaration and the exports are **HUMAN-REQUIRED INPUT** and do not exist | The derived log is audited against the authorisation by `verify-event-log --authorization` (`cpg_u1_data.mjs:823-834`) |

**A response that never arrives** is archived as a record with `canonical_response: null` and an `executor_error`,
and the company is reported INVALID (`lib/harness.mjs:99-103`, §15.2) — the run does not abort and nothing is
retried.

---

## 7. Validation actually run in this stream

All three commands were run read-only against the frozen clone. No file under `research/cpg-u1/**`,
`C:/tmp/dt002` or `C:/tmp/cpg049_integration/treatment` was modified; the tooling aggregate and the clone's HEAD
and porcelain state were re-checked afterwards and are unchanged.

```
$ cd C:/tmp/dt002/research/cpg-u1/tooling
$ CPG_U1_RESOLVER_CLONE='C:\tmp\cpg049_integration\treatment' node test/adapter_conformance.mjs
adapter conformance: 18 passed, 0 failed                                        # exit 0

$ CPG_U1_RESOLVER_CLONE='C:\tmp\cpg049_integration\treatment' node test/selftest.mjs
evaluation tree: declared commit f01a7eb4199be4e04d4fee7fc0116303949dc553,
  tree 3b4811fc88e9fbb64ee42c37c4aacca2e76c67af,
  aggregate ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5 (11552 files)
  — verified against C:\tmp\cpg049_integration\treatment
selftest: 1022 passed, 0 failed                                                 # exit 0

$ cd C:/tmp/dt4-exec
$ CPG_U1_TOOLING='C:\tmp\dt002\research\cpg-u1\tooling' \
  CPG_U1_RESOLVER_CLONE='C:\tmp\cpg049_integration\treatment' \
  node research/deeptech-operations/execution/wikidata_snapshot_conformance.mjs
wikidata snapshot conformance: 15 passed, 0 failed                              # exit 0

# non-vacuity: the same test with matched_label forced to null
wikidata snapshot conformance: 13 passed, 2 failed                              # exit 1
  FAIL: the snapshot reached the response: https://www.wikidata.org/wiki/Q999999999 is cited by §12.3 Rule A
  FAIL: an altered Wikidata snapshot changes the replayed response (the archive value is what CPG consumed)
```

**Every one of these is an ENGINEERING ARTIFACT.** None is U1 evidence. None is independent validation.

---

## 8. Readiness verdict

| Question | Answer |
|---|---|
| Is the execution machinery present and demonstrably correct on the four things §13.3 turns on (recording fetcher, raw-body capture, archive record, deterministic replay)? | **YES — VERIFIED**, 18/18 + 1022/1022 + 15/15, all against the frozen resolver, offline |
| Is any code missing before the authorised run? | **NO.** The gap found (untested Wikidata snapshot round trip) was a **test** gap, now closed, with zero change to the registered tooling |
| Can the authorised held-out run start? | **NO — BLOCKED on HUMAN-REQUIRED INPUT only.** Nothing technical blocks it |
| What blocks it | An accountable OSF identity and registration · a Bitcoin key custodian, funding outputs and both commitments · seven independent persons (§4A) · the frame, scan, manifests, seal and published seal record · the sampling evidence bundle (two header archives + ≥ 2 relay beacons) · the sealed reference file · the signed no-preview declaration. **All §19.1/§19.3 human prerequisites, none of them in this stream's remit** |

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

