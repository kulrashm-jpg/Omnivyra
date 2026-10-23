# DR-2 — §19.3's "certenv with a fixture tenant" HAS NO CORRESPONDING CODE PATH

**CLASSIFICATION: PREPARATION.** This memo decides nothing. **Protocol-004 was not edited.** No
environment was provisioned, no tenant was created, no database was touched, no credential was read or
written. Every claim below was verified read-only in this task and is cited to file and line.

**Protocol:** `research/cpg-u1/CPG_U1_PROTOCOL_004.md`,
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **recomputed and VERIFIED**.
Protocol line numbers are of the file at that hash.
**Instrument:** `C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`<NEW_AGG>`, <NEW_N> files — **recomputed and
VERIFIED**.
**Frozen treatment clone:** `C:/tmp/cpg049_integration/treatment`, HEAD
`f01a7eb4199be4e04d4fee7fc0116303949dc553`, `git status --porcelain` empty — **VERIFIED read-only**.

---

## 1. What the protocol says

Protocol line **961** (§19.3, "Named prerequisites"):

> Also required before held-out execution: recording fetcher, recording Wikidata lookup, replay harness
> (§13); **certenv with a fixture tenant**; two independent Bitcoin header sources (or an own node) and
> ≥ 2 drand relays for verification.

The word `certenv` occurs in the whole protocol exactly **twice**, and the other occurrence is not a
requirement at all — protocol line **466** (§6.5, the preview prohibition):

> **Preview (prohibited).** Any execution of CPG, in any environment (production, staging, **certenv**,
> local, harness) and through any entry point …

So line 466 treats "certenv" as one of the organisation's ambient environments in which CPG must not be
previewed, and line 961 lists it as a thing that must "exist before the stated act". §19.3's own heading
is explicit that these are "**not decisions**; must exist before the stated act" — it is a readiness
list, not a mechanism.

## 2. What the code needs — four claims, each verified

### 2.1 `FIXTURE_COMPANY_ID` is a label and nothing else — VERIFIED

`lib/harness.mjs:13`:

```js
export const FIXTURE_COMPANY_ID = 'CPG-U1-FIXTURE';
```

`lib/harness.mjs:31-34` is its **only** use in the whole instrument:

```js
31  /** §7 treatment input, built only from the sealed frame row and the registered asOf. */
32  export function lookupInput(frameRow, asOf) {
33    return { companyId: FIXTURE_COMPANY_ID, companyName: frameRow.company_name, websiteUrl: `https://${frameRow.canonical_domain}`, linkedinUrl: null, asOf };
34  }
```

**VALIDATION (actually run):** `grep -n "FIXTURE_COMPANY_ID\|companyId" lib/*.mjs cpg_u1_data.mjs`
returns exactly two hits, both in `lib/harness.mjs` (lines 13 and 33). There is **no lookup, no
provisioning, no existence check and no tenant resolution** anywhere. The constant is a literal string
handed to the treatment function as the `companyId` field of its input, identical for **every** company
in the frame — which is precisely the point of §7: the treatment input is built "only from the sealed
frame row and the registered asOf", so the company identity that matters travels in `companyName` and
`websiteUrl`, and `companyId` is deliberately constant so that it cannot carry information.

A constant string that is the same for all 210+ frame rows cannot be a tenant. It is a placeholder that
makes the treatment function's signature satisfiable.

### 2.2 The evaluated path touches no database — VERIFIED

The only bridge into CPG is `lib/cpgExecutor.mjs` (line 1: "Only this bridge reaches CPG"), which spawns
`harness/cpgAdapter.ts` under the frozen clone's own `tsx` (`lib/cpgExecutor.mjs:29-37`). What the
adapter imports from the frozen clone is exhaustively listed at `harness/cpgAdapter.ts:110-115`:

```ts
110  const base = `file:///${clone.replace(/\\/g, '/')}/backend/services`;
111  const cpg = await import(`${base}/companyProfile/grounding/companyFactsLookup.ts`);
112  if (req.mode === 'execute') {
113    const sef = await import(`${base}/companyProfile/grounding/acquisition/safeEvidenceFetcher.ts`);
114    const wd = await import(`${base}/intelligence/adapters/wikidataAdapter.ts`);
115    const out = await recordLookup(req.input, { lookup: cpg.lookupGroundedCompanyFacts, fetcher: sef.createSafeEvidenceFetcher({ budgetMs: 45_000 }), wikidataLookup: wd.lookupCompanyFirmographicsFromWikidata });
```

Three module imports, one function call. Both external effects — HTTP and Wikidata — are **injected** by
the harness (`harness/cpgAdapter.ts:46-68`) so they can be recorded and replayed. Nothing else is wired.

In the frozen clone at `f01a7eb4…`:

- `backend/services/companyProfile/grounding/companyFactsLookup.ts` imports, lines **27-33**: `./types`,
  `./acquisition/orchestrator`, `./acquisition/wikidataSource`, `./acquisition/evidenceSource`,
  `./entityResolution`, `./registry/builtins`, `../../../../utils/companyProfileValidation`. **No
  database client, no Supabase client, no ORM.**
- `companyId` appears in that file exactly twice: line **97** (the input type) and line **116**
  (copied into the orchestration input). In `acquisition/orchestrator.ts` it appears at lines 47, 71,
  143, 180 and 198 — every one a type declaration or a copy into a result record.
- **VALIDATION (actually run):**
  `grep -rn "supabaseAdmin\|createClient\|getSupabase\|from('\|from(\"" backend/services/companyProfile/grounding/`
  → **no matches**. The entire grounding subtree the treatment runs in contains no database access.

Furthermore, even if a database client existed, it could not be configured: `lib/cpgExecutor.mjs:15-21`
allow-lists the child process environment:

```js
15  export const OS_ENV_NAMES = Object.freeze(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
16  export const PINNED_ENV = Object.freeze({ CACHE_KILL_ALL: '1' });
17  export function adapterEnv(clone, parent = process.env) {
18    const env = {};
19    for (const k of OS_ENV_NAMES) if (parent[k] !== undefined) env[k] = parent[k];
20    return { ...env, ...PINNED_ENV, CPG_U1_RESOLVER_CLONE: clone };
21  }
```

Fifteen operating-system variables, `CACHE_KILL_ALL=1`, and the clone path. The comment at lines 12-14
states the intent: "nothing else from the operator's shell (no credentials, no rollout or cache
overrides)". **No `DATABASE_URL`, no `SUPABASE_*`, no tenant, no key can reach the evaluated path**, by
construction. `probe-environment` (`harness/cpgAdapter.ts:120-121`) exists specifically so the operator
can prove this by listing `Object.keys(process.env)` inside the child.

### 2.3 A literal certenv inside the resolver clone is REFUSED — VERIFIED

`cpg_u1_data.mjs:752-757`:

```js
752  function resolverState() {
753    const clone = process.env.CPG_U1_RESOLVER_CLONE;
754    if (!clone || !existsSync(clone)) fail('CPG_U1_RESOLVER_CLONE must name the frozen resolver clone');
755    const git = (...a) => execFileSync('git', ['-C', clone, ...a], { encoding: 'utf8' }).trim();
756    const envFiles = readdirSync(clone).filter((f) => /^\.env/.test(f) && !f.endsWith('.example'));
757    return { clone, head: git('rev-parse', 'HEAD'), clean: git('status', '--porcelain') === '', envFiles, providerConfigurationSha: providerConfigurationSha(clone) };
```

The `readdirSync` at line **756** collects the clone **root** directory only.
`lib/harness.mjs:53` then refuses:

```js
53  verify(Array.isArray(ctx.resolver?.envFiles) && ctx.resolver.envFiles.length === 0, 'RESOLVER_ENV_FILES', `resolver clone contains environment files (${(ctx.resolver?.envFiles ?? ['unknown']).join(', ')}); the evidence environment must hold no credentials`);
```

This is a `VERIFICATION_FAILURE` refusal — the harness fails closed and **executes nothing**. It is
mutation-covered: `test/mutate.mjs` **M249** "harness accepts a resolver clone with environment files"
disables exactly this guard and must be killed. It is also documented as an operator requirement,
`README.md:273`: "a clone at the frozen SHA with its lockfile dependencies installed
(`npm ci --ignore-scripts`), **no `.env*` files**".

The frozen clone today satisfies it **by a hair**: `ls -a C:/tmp/cpg049_integration/treatment | grep
'^\.env'` returns exactly `.env.beta.example` and `.env.cert.example`. Both end in `.example`, so the
filter excludes them and `envFiles` is `[]`. Note what `.env.cert.example` is: the **template for a
certenv**. The clone carries the certenv *template*, and the moment anyone fills it in — producing
`.env.cert` — the harness refuses to run. **The instrument treats a real certenv inside the evidence
environment as a defect, not a prerequisite.**

### 2.4 "certenv" does not appear in the instrument at all — VERIFIED

**VALIDATION (actually run):**
`grep -rn "certenv\|CERT_ENV" --include=*.mjs --include=*.md . | grep -v node_modules` over the whole
tooling tree → **no matches**. Not in the CLI, not in the libraries, not in the self-test, not in the
mutation set, not in the 26 KB README. There is no flag, no environment variable, no check and no
documented step that corresponds to §19.3's phrase.

## 3. What the protocol requires versus what the code needs

| | §19.3 line 961 (the words) | The instrument (the mechanism) |
|---|---|---|
| Environment | "certenv" — a named certification environment | The **frozen resolver clone** at `f01a7eb4…`, clean tree, dependencies installed, and **no `.env*` file** (`README.md:273`; `lib/harness.mjs:52-53`) |
| Tenant | "a fixture tenant" | `FIXTURE_COMPANY_ID = 'CPG-U1-FIXTURE'` — one constant string, identical for every frame row, never looked up (`lib/harness.mjs:13, 33`) |
| Credentials | implied by "environment" | **Forbidden.** Allow-listed child env of 15 OS variables + `CACHE_KILL_ALL` + the clone path (`lib/cpgExecutor.mjs:15-21`) |
| Persistence | implied by "tenant" | **None.** No DB client anywhere under `backend/services/companyProfile/grounding/` in the frozen clone; three module imports total (`harness/cpgAdapter.ts:110-115`) |
| Enforcement | none | `RESOLVER_ENV_FILES` refusal, mutation-covered by M249 |

**The divergence is not that the protocol demands more than the code delivers. It is that the protocol's
words and the code's guarantee point in opposite directions:** the protocol names an *environment with a
tenant*, and the instrument's guarantee is precisely that the evaluated path runs in an environment with
**no** environment files, **no** credentials and **no** persistence. Satisfying the words literally
degrades the study; satisfying the mechanism is what §13.1 actually asks for ("run cold", frozen SHA,
recorded fetcher, replayable).

Read charitably — and this is the most likely reading — §19.3's phrase is a **readiness note inherited
from an earlier draft**, meaning "you must have somewhere to run the resolver that is not production".
The instrument's answer to that note is the frozen clone, and it is stricter than a certenv.

## 4. The three options

### Option (a) — register as-is; disclose the divergence in the registration note

**What it means.** Register with `protocol_sha256 = c50fc680…` unchanged. In the registration narrative,
state in terms: §19.3's "certenv with a fixture tenant" is satisfied, in the instrument, by the frozen
resolver clone at `f01a7eb4199be4e04d4fee7fc0116303949dc553` with no `.env*` file and by the constant
`FIXTURE_COMPANY_ID = 'CPG-U1-FIXTURE'`; the evaluated path touches no database and receives no
credentials; a literal certenv file inside the clone would be refused by the harness. This sits beside
the disclosure the previous wave already prepared for the "tooling v4" / `cpg-u1-data-tooling-6` naming
divergence (`REGISTRATION_PACKAGE.md` §5, `OPERATOR_CHECKLIST.md` §0.2) and is the same kind of item.

| | |
|---|---|
| **Protocol SHA impact** | **None.** `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` is registered as-is. |
| **Tooling aggregate impact** | **None.** `<NEW_AGG>` unchanged. |
| **Registration invalidated?** | **No.** |
| **Re-verification forced** | **None.** `verify-protocol` already passes on this file (all 20 `PROTOCOL_MARKERS`, `cpg_u1_data.mjs:283-285`). |
| **Cost** | A paragraph in the registration narrative, plus the §13.2A archive recording the clone SHA, its clean-tree status and its empty `envFiles` list. |
| **Risk** | An outsider reading §19.3 may ask what the certenv was. The disclosure answers that in advance, which is strictly better than an outsider discovering the gap unaided. |

### Option (b) — issue a new protocol version as a NEW file with a new SHA, before registering

**What it means.** Write a new protocol file (never editing `CPG_U1_PROTOCOL_004.md`) whose §19.3 names
the frozen resolver clone instead of a certenv, hash it, and register that hash.

**There is a trap here that the owner must see before choosing.** The tooling pins the protocol
*version string*, not just the hash:

- `lib/registration.mjs:9` — `export const PROTOCOL_VERSION = 'CPG_U1_PROTOCOL_004';`
- `lib/registration.mjs:77` — `if (reg.protocol_version !== PROTOCOL_VERSION) errors.push(…)` — an
  **ERROR**, exit 1.
- `cpg_u1_data.mjs:283-285` — `PROTOCOL_MARKERS` begins with `PROTOCOL_VERSION`, and
  `cmdVerifyProtocol` (`:287-294`) fails unless the protocol text **contains the literal string**
  `CPG_U1_PROTOCOL_004`.
- `lib/registration.mjs:55` — `verification_procedure` is built as
  `` `${PROTOCOL_VERSION} §21 (cpg_u1_data.mjs verify-sampling)` ``.

So a file called `CPG_U1_PROTOCOL_005.md` is only usable if it still contains the string
`CPG_U1_PROTOCOL_004` and the registration still declares `protocol_version: CPG_U1_PROTOCOL_004` —
which is confusing but mechanically legal. Renaming the version properly means editing
`lib/registration.mjs`, and **that moves the tooling aggregate too**, dragging in the whole
re-verification cost set out in `DR1_DRAND_RELAY_FLOOR_MEMO.md` option (b).

| | |
|---|---|
| **Protocol SHA impact** | `protocol_sha256` becomes a new value. It is bound in the registration record (`lib/registration.mjs:38`), in **both** stage manifests (`lib/harness.mjs:49` and `:155`), in the **on-chain commitment payload** (`lib/commitment.mjs:11`, `:31`) and in the execution authorization (`lib/execution.mjs:49`, `:65`). It is also a **sampling field** (`lib/registration.mjs:119`). |
| **Tooling aggregate impact** | **None if and only if** the new file keeps the literal string `CPG_U1_PROTOCOL_004` and the tooling is not touched. If the version constant is renamed, the aggregate moves as well — two SHAs to re-freeze instead of one. |
| **Registration invalidated?** | **No, if done before registration.** `registration-fields` hashes whatever `--protocol` names at run time (`cpg_u1_data.mjs:269`), so the new SHA simply becomes the registered one. **Yes, if done after** — `registered()` (`cpg_u1_data.mjs:177`) and `lib/harness.mjs:43` both abort `VERIFY_ABORT_HASH_MISMATCH` / `PROTOCOL_MISMATCH`, and re-registering to fix it is study VOID (`lib/registration.mjs:119, :140-141`). |
| **Re-verification forced** | `node cpg_u1_data.mjs verify-protocol --protocol <new file>` must exit **0**, which requires the new text to still contain **all twenty** `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:283-285`), including `'UNASSIGNED'`, `'E ≥ 126 / 52 / 32'`, `'Δ = 3 h'` and the quicknet chain hash. Then the identity tables in all five prior registration documents must be rebuilt, since all five quote `c50fc680…`. If the tooling is touched, add the whole self-test / 389-mutant / adapter-conformance set. |
| **What it buys** | Textual agreement between the protocol and the instrument. |
| **What it costs beyond the SHA** | A frozen, reviewed protocol is the study's strongest artefact. Re-opening it to fix one clause in a readiness list invites re-opening it for others, and every re-issue is another reviewed document. The divergence is disclosable at zero cost under option (a). |

### Option (c) — stand up something that satisfies the words literally

**What it means.** Provision an actual certification environment with an actual fixture tenant, so that
§19.3 reads true on its face.

**The harness refuses this, and the refusal is the point.** Concretely, every way of doing it fails:

1. **Put the certenv config in the resolver clone.** A file named `.env.cert` (or `.env`, `.env.local`,
   `.env.certenv` — anything matching `/^\.env/` that is not `*.example`) in the clone root is collected
   at `cpg_u1_data.mjs:756` and refused at `lib/harness.mjs:53` with
   `RESOLVER_ENV_FILES: resolver clone contains environment files (.env.cert); the evidence environment
   must hold no credentials`. The harness fails closed: **nothing executes.** This is the guard that
   mutant **M249** exists to kill. Note the clone already ships `.env.cert.example` — filling it in is
   exactly the refused act.
2. **Put the certenv config outside the clone, in the operator's shell.** `lib/cpgExecutor.mjs:17-21`
   copies only the 15 names in `OS_ENV_NAMES` into the child, plus `CACHE_KILL_ALL` and
   `CPG_U1_RESOLVER_CLONE`. Any `DATABASE_URL`, `SUPABASE_*` or tenant variable is **dropped**. The
   certenv would exist and be invisible to the evaluated path — cost incurred, requirement still not
   met in any meaningful sense.
3. **Create the fixture tenant in a database.** No code path in the evaluated subtree reads it (§2.2:
   zero DB references under `backend/services/companyProfile/grounding/`), and `companyId` is the
   constant `'CPG-U1-FIXTURE'` for every row, never resolved. The tenant would be a row nothing queries.
   Creating it also requires database access, which this task is prohibited from having and which the
   study's own §6.5 preview prohibition (protocol line 466) names `certenv` as an environment in which
   CPG must not be executed at all.
4. **Modify the harness to permit an env file.** That is a tooling edit: aggregate moves, full
   re-verification, and it deletes a mutation-covered guarantee ("the evidence environment must hold no
   credentials") in order to satisfy a phrase in a readiness list. It makes the study weaker.

| | |
|---|---|
| **Protocol SHA impact** | None (the protocol is not edited) — unless route 4 is taken, which moves the **tooling** aggregate. |
| **Registration invalidated?** | Route 4 before registration: no, but the aggregate changes. Routes 1-3: registration is unaffected, but **held-out execution becomes impossible** (route 1) or the work is inert (routes 2-3). |
| **Verdict** | **Not viable.** Route 1 is refused by design, routes 2 and 3 are inert, route 4 trades a verified guarantee for a wording match. |

## 5. Validation actually performed for this memo

### 5.1 Commands run (real output)

| Command | Result | Status |
|---|---|---|
| `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` in `C:/tmp/dt4-reg` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | **VERIFIED** |
| Replication of `lib/aggregate.mjs` against the instrument (read-only) | `files: <NEW_N>`, `aggregate: <NEW_AGG>` | **VERIFIED** |
| `grep -n "certenv" research/cpg-u1/CPG_U1_PROTOCOL_004.md` | 2 hits: lines **466** and **961** | **VERIFIED** |
| `grep -rn "certenv\|CERT_ENV" --include=*.mjs --include=*.md .` over the tooling tree (node_modules excluded) | **no matches** | **VERIFIED** |
| `grep -n "FIXTURE_COMPANY_ID\|companyId" lib/*.mjs cpg_u1_data.mjs` | 2 hits, both `lib/harness.mjs` (13, 33) | **VERIFIED** |
| `grep -n "envFiles" lib/*.mjs cpg_u1_data.mjs` | `lib/harness.mjs:53`, `cpg_u1_data.mjs:756-757` | **VERIFIED** |
| `git -C C:/tmp/cpg049_integration/treatment rev-parse HEAD` | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | **VERIFIED** |
| `git -C C:/tmp/cpg049_integration/treatment status --porcelain \| wc -l` | `0` (clean tree) | **VERIFIED** |
| `ls -a C:/tmp/cpg049_integration/treatment \| grep '^\.env'` | `.env.beta.example`, `.env.cert.example` — both `*.example`, so `envFiles` is `[]` | **VERIFIED** |
| `grep -rn "supabaseAdmin\|createClient\|getSupabase\|from('\|from(\"" backend/services/companyProfile/grounding/` in the frozen clone | **no matches** | **VERIFIED** |
| `grep -n "^import" backend/services/companyProfile/grounding/companyFactsLookup.ts` | 7 imports, lines 27-33, none a database client | **VERIFIED** |
| `node test/mutate.mjs --anchors` | `anchors: 389/389 occur exactly once`, exit **0** (confirms M249 is live and its anchor unique) | **VERIFIED** |

### 5.2 Deliberately NOT run

| Check | Status | Why |
|---|---|---|
| `node cpg_u1_data.mjs verify-protocol` | **NOT RUN** | Not required by any claim here; its marker list was read instead (`cpg_u1_data.mjs:283-285`). Listed as a cost of option (b). |
| `node test/selftest.mjs`, full `test/mutate.mjs`, `test/adapter_conformance.mjs` | **NOT RUN** | Require `CPG_U1_RESOLVER_CLONE` / `CPG_U1_ADAPTER_CLONE`; no claim depends on them. |
| `harness-held-out` / `harness-pilot` / `probe-environment` | **NOT RUN — PROHIBITED** | Would execute CPG. §6.5 (protocol line 466) forbids any preview. |
| Provisioning a certenv or a fixture tenant | **NOT DONE — PROHIBITED** | No environment, tenant, credential or database was created, read or altered. |
| Any edit to `CPG_U1_PROTOCOL_004.md` | **NOT DONE — PROHIBITED** | The protocol is frozen at `c50fc680…`. |

---

## 6. DECISION REQUIRED — DR-2

**PROBLEM.** Protocol-004 §19.3 (protocol line 961) names "**certenv with a fixture tenant**" as a
prerequisite before held-out execution, but nothing in the instrument corresponds to it. `certenv` does
not appear anywhere in the <NEW_N>-file tooling tree. `FIXTURE_COMPANY_ID` (`lib/harness.mjs:13`) is a single
constant string `'CPG-U1-FIXTURE'`, used only at `lib/harness.mjs:33` and identical for every frame row —
never looked up, never provisioned. The evaluated path touches no database: the adapter imports three
modules (`harness/cpgAdapter.ts:110-115`), the grounding subtree of the frozen clone contains **no**
database client, and the child process environment is allow-listed to 15 OS variables plus
`CACHE_KILL_ALL` and the clone path (`lib/cpgExecutor.mjs:15-21`). And a literal certenv **inside** the
resolver clone would be **refused**: `cpg_u1_data.mjs:756` collects any root `/^\.env/` file that is not
`*.example`, and `lib/harness.mjs:53` fails closed with `RESOLVER_ENV_FILES` — a guard that mutant
**M249** exists to kill and that `README.md:273` states as an operator requirement ("no `.env*` files").
The clone today ships `.env.cert.example`; filling it in is precisely the refused act.

**AFFECTED ARTIFACT.** `research/cpg-u1/CPG_U1_PROTOCOL_004.md`,
`protocol_sha256 = c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — §19.3, protocol
line 961, one clause. Downstream, that SHA is bound in the registration record
(`lib/registration.mjs:38`), in **both** stage manifests (`lib/harness.mjs:49`, `:155`), in the on-chain
commitment payload (`lib/commitment.mjs:11`, `:31`) and in the execution authorization
(`lib/execution.mjs:49`, `:65`), and it is a **sampling field** (`lib/registration.mjs:119`).

**CONSEQUENCE.** The prerequisite as written is unsatisfiable in any way that helps, and the instrument's
actual guarantee is the **opposite** of what the words describe: the evaluated path runs in an
environment with no `.env*` file, no credentials and no persistence. The words and the mechanism point in
opposite directions, so the only real question is whether to say so or to change the text. No execution
is blocked by the divergence today — `verify-protocol` passes on this file, and the harness's readiness
check is about the clone, not about a certenv. The exposure is purely one of external legibility: an
outsider reading §19.3 will look for a certenv and find none.

**OPTIONS.**
- **(a) Register as-is; disclose the divergence in the registration note.** Protocol SHA unchanged
  (`c50fc680…`); tooling aggregate unchanged (`<NEW_AGG>`); no re-verification. The note states that
  §19.3's clause is satisfied by the frozen resolver clone at `f01a7eb4199be4e04d4fee7fc0116303949dc553`
  with an empty `envFiles` list and by the constant `FIXTURE_COMPANY_ID`, that the evaluated path touches
  no database and receives no credentials, and that a literal certenv in the clone would be refused.
  Sits beside the already-prepared "tooling v4" naming disclosure.
- **(b) Issue a new protocol version as a NEW file with a new SHA before registering.** `protocol_sha256`
  changes and becomes the registered value. Requires `verify-protocol` to exit 0, i.e. the new text must
  still contain **all twenty** `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:283-285`), **and** must still contain
  the literal string `CPG_U1_PROTOCOL_004`, because `PROTOCOL_VERSION` is pinned in the tooling
  (`lib/registration.mjs:9`, enforced at `:77`) and the registration must declare that exact version
  string. Renaming the version properly requires editing `lib/registration.mjs`, which moves the
  **tooling aggregate** as well and drags in the full re-verification set from
  `DR1_DRAND_RELAY_FLOOR_MEMO.md` option (b). All five prior registration documents' identity tables must
  be rebuilt.
- **(c) Stand up something that satisfies the words literally.** **Not viable.** A certenv file in the
  clone is refused (`lib/harness.mjs:53`, mutant M249) and stops held-out execution entirely; a certenv
  outside the clone is dropped by the child-env allow-list (`lib/cpgExecutor.mjs:17-21`) and is
  therefore inert; a fixture tenant in a database is a row nothing queries (no DB client in the
  evaluated subtree) and requires prohibited production access; and relaxing the harness to accept an
  env file trades a mutation-covered guarantee for a wording match and makes the study weaker.

**WHETHER REGISTRATION WOULD BE INVALIDATED.**
- Option (a): **No.** Nothing changes.
- Option (b): **No, if and only if the new file exists and is hashed before `registration-fields` is
  run** — `cpg_u1_data.mjs:269` hashes `--protocol` at run time, so the new SHA simply becomes the
  registered one. **Yes if done after registration:** `registered()` aborts
  `VERIFY_ABORT_HASH_MISMATCH` (`cpg_u1_data.mjs:177`) and `lib/harness.mjs:43` refuses
  `PROTOCOL_MISMATCH`, while re-registering to fix it is study VOID because `protocol_sha256` is a
  sampling field (`lib/registration.mjs:119, :140-141`). Irreversible once the development commitment is
  broadcast, since the SHA is inside the on-chain payload digest.
- Option (c): routes 2-4 do not invalidate the registration; **route 1 makes held-out execution
  impossible**, which is worse than an invalid registration because it happens after the money is spent.

**OWNER MUST DECIDE:** (a), (b) or (c). **UNASSIGNED — the study owner / methodological authority. This
memo decides nothing, and Protocol-004 was not edited.**

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

