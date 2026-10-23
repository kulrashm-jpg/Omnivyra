# BATCH1_REMEDIATION — `scripts/platform-isolation-check.ts` detector integrity

**Artefact class: ENGINEERING ARTIFACT** (the script change and its test) **+ EXECUTION EVIDENCE**
(§2 before / §4 after detector runs, §5 test run).

> The before/after detector output in this document is **EXECUTION EVIDENCE of the detector only**.
> It is **not** a security assurance. A detector that now reports its three rules says nothing about
> whether the platform/tenant boundary is correct — it says only that the tool can now see. Every hit
> below still needs triage on its merits.

| Field | Value |
|---|---|
| Task | DEEPTECH-PARALLEL-005 TASK M2 — Batch 1 of `SECURITY_FOLLOWUP_INVENTORY.md` |
| Base SHA | `af2fb6e99ce461894bf16f18c2251f75088eba18` (detached) |
| Worktree | `C:/tmp/dt5-sec` — **DISPOSABLE**, uncommitted |
| Source inventory | `C:/tmp/dt004-operations/corporate/SECURITY_FOLLOWUP_INVENTORY.md` |
| Items implemented | **L-03 (prune) → L-01 (path fix) → L-02 (de-duplicate)**, in that order |
| Commit / push / PR | **None.** No commit, no branch, no PR |
| Network / DB / credentials | **None.** No network call, no database access, no `.env*` read, no credential read |
| Runtime behaviour changed | **None.** The only changed product-tree file is a developer-tooling script that nothing imports and nothing executes in any runtime path |

---

## 1. Findings independently re-verified at `af2fb6e9` before any change

Each of the five established findings was re-confirmed in this worktree, not taken from the inventory's
status column.

| # | Finding | Verified how | Verdict |
|---|---|---|---|
| 1 | Output paths absolute, so the repo-relative allowlist and rules (1) and (2) can never match | `scripts/platform-isolation-check.ts:122` (`const cwd = process.cwd();`), `:124` (`const root = join(cwd, d);`), `walk()` `:75-86` yields `join(root, entry)`, `scanFile()` `:89` (`const rel = file.replace(/\\/g, '/');` — separator conversion only, no prefix strip). Consumers dead: `:90` `ALLOWLIST.has(rel)`, `:98` `rel.startsWith('pages/api/super-admin/')`, `:103` same prefix. Confirmed by the §2 run printing `C:/tmp/dt5-sec/...` and reporting **zero** hits in both prefix-gated categories | **CONFIRMED** |
| 2 | Double-counts because scan roots overlap — 15 reported, 13 distinct | `:42` `SCAN_DIRS = ['pages/api/super-admin', 'pages/api/admin', 'components', 'pages']` — `pages` subsumes the first two; `main()` `:124-134` walks each root independently with no de-duplication. In the §2 output `pages/api/super-admin/free-credits/grant.ts:116` and `.../requests.ts:117` each appear **twice** | **CONFIRMED** |
| 3 | Proven false negative: `pages/api/super-admin/creator-operations.ts` uses `requireSuperAdminUser(` and is not reported | `grep -rn 'requireSuperAdminUser[[:space:]]*(' pages/api/super-admin/` → exactly one hit, `pages/api/super-admin/creator-operations.ts:43:  const admin = await requireSuperAdminUser(req, res);`. Absent from the §2 output | **CONFIRMED** |
| 4 | Not wired into CI, not an npm script — 3 self-references only | `grep -rn 'platform-isolation-check' --include='*.json' --include='*.yml' --include='*.yaml' --include='*.ts' --include='*.md' .` (node_modules excluded) → `scripts/platform-isolation-check.ts:2`, `:29`, `:143`. All three are the script referring to itself. No `package.json` script (`npm run` listing confirms), no workflow reference | **CONFIRMED** |
| 5 | Stale `purchases/complete` allowlist entry whose justification no longer holds | `:63-64` allowlists `pages/api/super-admin/purchases/complete.ts` as "uses `BILLING_PURCHASE` intentionally per-org". `grep -c 'requireSuperAdminUser' pages/api/super-admin/purchases/complete.ts` → **0**; no shared-capability line remains (see §4 note) | **CONFIRMED** |

Line numbers in the table refer to the **pre-change** file.

---

## 2. BEFORE — verbatim output

The repository's own invocation was discovered, not guessed: the script's header (`:28-29`) documents
`npx tsx scripts/platform-isolation-check.ts`, and finding 4 above confirms there is no npm script or
workflow alternative. `tsx` is resolved from the shared `node_modules`.

```
$ cd /c/tmp/dt5-sec && C:/virality/node_modules/.bin/tsx scripts/platform-isolation-check.ts
platform-isolation-check: 15 potential boundary issues across 4 scan roots

[role_equality] (15)
  C:/tmp/dt5-sec/pages/api/super-admin/free-credits/grant.ts:116  } else if (existingRole.role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/api/super-admin/free-credits/requests.ts:117  } else if (existingRole.role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/components/CompanyContext.tsx:796  isAdmin: userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN',
  C:/tmp/dt5-sec/pages/admin/users.tsx:33  const canManageUsers = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
  C:/tmp/dt5-sec/pages/admin/users.tsx:35  if (userRole === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/admin/users.tsx:133  {userRole === 'SUPER_ADMIN' && (
  C:/tmp/dt5-sec/pages/admin/users.tsx:210  {userRole === 'SUPER_ADMIN' && (
  C:/tmp/dt5-sec/pages/api/external-apis/presets.ts:154  if (access.role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/api/social-accounts/status.ts:195  const isSuperAdminCaller = userRole === 'SUPER_ADMIN';
  C:/tmp/dt5-sec/pages/api/super-admin/free-credits/grant.ts:116  } else if (existingRole.role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/api/super-admin/free-credits/requests.ts:117  } else if (existingRole.role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/super-admin/bolt-failures.tsx:89  if (userRole === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/super-admin/consumption.tsx:86  if (role === 'SUPER_ADMIN') {
  C:/tmp/dt5-sec/pages/super-admin.tsx:107  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  C:/tmp/dt5-sec/pages/team-management.tsx:54  userRole === 'SUPER_ADMIN' ||

Categories:
  super_admin_user_legacy       — legacy `requireSuperAdminUser` Bearer-only check; migrate to requireCapability + platform-tier capability
  shared_cap_in_platform_route  — per-tenant capability used on a platform route; migrate to a platform-tier capability
  role_equality                 — literal `=== 'SUPER_ADMIN'` check; migrate to canonical capability check

Allowlisted files: 8
See backend/security/platformCapabilities.ts for the platform-tier list.
```

Three defects visible in that output at once: absolute `file` values; both prefix-gated categories
silently absent; `Allowlisted files: 8` asserted while the allowlist suppresses nothing.

---

## 3. The change

One file changed: `scripts/platform-isolation-check.ts` (+100 / −28). Applied in the inventory's
mandated order.

### 3.1 L-03 — prune the stale allowlist entry (first)

Removed `'pages/api/super-admin/purchases/complete.ts'` and its justifying comment, replaced by a
comment recording why it was pruned. Pruned **before** the path fix precisely so that turning the two
dead rules on did not turn them on against an unjustified suppression.

### 3.2 L-01 — repo-relative path handling (second)

- Added `REPO_ROOT`, derived from `__dirname` (`<repo>/scripts/..`) rather than `process.cwd()`, so
  the base no longer depends on where the script is invoked from.
- Added `toRepoRelative(file, repoRoot)` — the single conversion site. Applied in `collectFiles()`
  before any rule or allowlist lookup sees a path.
- Split the old `scanFile(absPath)` into a pure `scanSource(rel, src, allowlist)` (rules only, no
  filesystem) and a thin `scanFile(rel, repoRoot)` (read + delegate). The rule predicates themselves
  are **unchanged** — the defect was the input, not the logic.
- Rule (3)'s tolerance guards were `rel.includes('/tests/')` etc. Under absolute paths those matched
  a **top-level** `tests/` or `scripts/` directory too (`C:/repo/tests/x.ts` contains `/tests/`).
  Under repo-relative paths `tests/x.ts` does not. Replaced with `hasSegment(rel, 'tests')`, which
  matches a whole path segment at any position including the first — this **preserves** the original
  tolerance rather than narrowing it. Without this the fix would have introduced new false positives
  in top-level `tests/`.

### 3.3 L-02 — de-duplicate (third)

- `collectFiles(dirs, repoRoot)` walks every declared root and accumulates repo-relative paths into a
  `Set`, returning a sorted, distinct list. Each file is therefore scanned exactly once **regardless
  of how the roots overlap** — a structural guarantee, not a hand-pruned `SCAN_DIRS`.
- `SCAN_DIRS` is deliberately left as declared (including the nested entries) because the narrower
  entries document where the boundary matters; they are now free of cost. The choice is recorded in a
  comment at the constant.
- The headline line now also reports the distinct file count.

### 3.4 Testability

`main()` was called unconditionally at module load. It is now guarded by
`require.main === module`, so the rule functions can be imported by a test without the script printing
a report. Direct invocation is unchanged (verified in §4). The package is CJS (`package.json` has no
`"type"`), and both `tsx` and `ts-jest` load this file as CJS.

### 3.5 Full diff

```diff
--- a/scripts/platform-isolation-check.ts
+++ b/scripts/platform-isolation-check.ts
@@ header @@
+ * Path convention (DEEPTECH-PARALLEL-005 Batch 1, L-01):
+ *   Every path this script compares, allowlists or prints is **repository
+ *   relative** with forward slashes (`pages/api/super-admin/foo.ts`). The
+ *   filesystem walk necessarily produces absolute paths; `toRepoRelative()` is
+ *   the single place that converts, and it is applied before any rule or
+ *   allowlist lookup sees a path. Previously `rel` was still absolute, so the
+ *   allowlist and rules (1) and (2) — all keyed on a `pages/api/super-admin/`
+ *   prefix — could never match.
-import { join } from 'node:path';
+import { join, relative, resolve } from 'node:path';
-interface Hit {
+export interface Hit {
-const SCAN_DIRS = [...] as const;
+/** ...overlap no longer inflates the report; collectFiles() de-duplicates (L-02). */
+export const SCAN_DIRS = ['pages/api/super-admin', 'pages/api/admin', 'components', 'pages'] as const;
+/** Repository root — this file lives in `<repo>/scripts/`. */
+export const REPO_ROOT = typeof __dirname === 'string' ? resolve(__dirname, '..') : process.cwd();
-const ALLOWLIST = new Set<string>([
+export const ALLOWLIST = new Set<string>([
-  // Super-admin/purchases/complete uses BILLING_PURCHASE intentionally per-org:
-  'pages/api/super-admin/purchases/complete.ts',
+  // Pruned (L-03): 'pages/api/super-admin/purchases/complete.ts' ... the
+  // justification no longer holds and the entry suppressed nothing it needed to.
+export function toRepoRelative(file: string, repoRoot: string = REPO_ROOT): string {
+  const rel = relative(repoRoot, resolve(repoRoot, file));
+  return rel.replace(/\\/g, '/');
+}
+function hasSegment(rel: string, segment: string): boolean {
+  return rel === segment || rel.startsWith(`${segment}/`) || rel.includes(`/${segment}/`);
+}
-function scanFile(file: string): Hit[] {
-  const rel = file.replace(/\\/g, '/');
-  if (ALLOWLIST.has(rel)) return [];
-  const src = readFileSync(file, 'utf8');
+export function collectFiles(dirs = SCAN_DIRS, repoRoot = REPO_ROOT): string[] {
+  const seen = new Set<string>();
+  for (const d of dirs) {
+    const root = join(repoRoot, d);
+    try { statSync(root); } catch { continue; }
+    for (const file of walk(root)) seen.add(toRepoRelative(file, repoRoot));
+  }
+  return [...seen].sort();
+}
+export function scanSource(rel: string, src: string, allowlist = ALLOWLIST): Hit[] {
+  if (allowlist.has(rel)) return [];
   const lines = src.split(/\r?\n/);
     // (3) ... tolerance guards
-      if (!rel.includes('/tests/') && !rel.includes('/__tests__/') && !rel.includes('/scripts/')) {
+      if (!hasSegment(rel, 'tests') && !hasSegment(rel, '__tests__') && !hasSegment(rel, 'scripts')) {
-function main(): void {
-  const cwd = process.cwd();
-  const all: Hit[] = [];
-  for (const d of SCAN_DIRS) { const root = join(cwd, d); ... all.push(...scanFile(file)); }
+export function scanFile(rel: string, repoRoot = REPO_ROOT): Hit[] {
+  return scanSource(rel, readFileSync(join(repoRoot, rel), 'utf8'));
+}
+export function collectHits(dirs = SCAN_DIRS, repoRoot = REPO_ROOT) {
+  const files = collectFiles(dirs, repoRoot);
+  const hits: Hit[] = [];
+  for (const rel of files) hits.push(...scanFile(rel, repoRoot));
+  return { hits, filesScanned: files.length };
+}
+export function main(): void {
+  const { hits: all, filesScanned } = collectHits();
-  console.log(`platform-isolation-check: ${all.length} potential boundary issues across ${SCAN_DIRS.length} scan roots`);
+  console.log(`platform-isolation-check: ${all.length} potential boundary issues in ${filesScanned} distinct files across ${SCAN_DIRS.length} scan roots`);
-main();
+// Run only when executed directly, so the rule functions above can be imported by tests.
+if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
+  main();
+}
```

The complete unabridged patch is reproducible in the worktree with
`git -C C:/tmp/dt5-sec diff -- scripts/platform-isolation-check.ts` (205 lines).

---

## 4. AFTER — verbatim output

```
$ cd /c/tmp/dt5-sec && C:/virality/node_modules/.bin/tsx scripts/platform-isolation-check.ts
platform-isolation-check: 14 potential boundary issues in 2454 distinct files across 4 scan roots

[super_admin_user_legacy] (1)
  pages/api/super-admin/creator-operations.ts:43  const admin = await requireSuperAdminUser(req, res);

[role_equality] (13)
  components/CompanyContext.tsx:796  isAdmin: userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN',
  pages/admin/users.tsx:33  const canManageUsers = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
  pages/admin/users.tsx:35  if (userRole === 'SUPER_ADMIN') {
  pages/admin/users.tsx:133  {userRole === 'SUPER_ADMIN' && (
  pages/admin/users.tsx:210  {userRole === 'SUPER_ADMIN' && (
  pages/api/external-apis/presets.ts:154  if (access.role === 'SUPER_ADMIN') {
  pages/api/social-accounts/status.ts:195  const isSuperAdminCaller = userRole === 'SUPER_ADMIN';
  pages/api/super-admin/free-credits/grant.ts:116  } else if (existingRole.role === 'SUPER_ADMIN') {
  pages/api/super-admin/free-credits/requests.ts:117  } else if (existingRole.role === 'SUPER_ADMIN') {
  pages/super-admin.tsx:107  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  pages/super-admin/bolt-failures.tsx:89  if (userRole === 'SUPER_ADMIN') {
  pages/super-admin/consumption.tsx:86  if (role === 'SUPER_ADMIN') {
  pages/team-management.tsx:54  userRole === 'SUPER_ADMIN' ||

Categories:
  super_admin_user_legacy       — legacy `requireSuperAdminUser` Bearer-only check; migrate to requireCapability + platform-tier capability
  shared_cap_in_platform_route  — per-tenant capability used on a platform route; migrate to a platform-tier capability
  role_equality                 — literal `=== 'SUPER_ADMIN'` check; migrate to canonical capability check

Allowlisted files: 7
See backend/security/platformCapabilities.ts for the platform-tier list.
```

### 4.1 Delta, measured

| Measure | Before | After | Reading |
|---|---|---|---|
| Reported total | 15 | 14 | — |
| `role_equality` | **15** (13 distinct) | **13** | **Matches the predicted direction exactly.** The two duplicated `free-credits` lines collapsed. The inflation is gone |
| `super_admin_user_legacy` | absent (rule dead) | **1** — `creator-operations.ts:43` | **Matches the prediction exactly.** The proven false negative is now reported. **The fix working, not a regression** |
| `shared_cap_in_platform_route` | absent (rule dead) | **0, and now genuinely evaluated** | See §4.2 |
| Path form | absolute (`C:/tmp/dt5-sec/...`) | repo-relative | The allowlist can now match |
| `Allowlisted files:` | 8 (inert) | 7 (effective) | −1 from the L-03 prune; the remaining 7 now actually suppress |
| Distinct files scanned | not reported | 2454 | Each file once |

Observed matched predicted on both headline points. No forcing of the expected figure was necessary.

### 4.2 The `shared_cap_in_platform_route` zero is a true negative, verified separately

Rule (2) going from dead to reporting zero is the one result that could be mistaken for the rule still
being broken, so it was confirmed independently of the detector:

```
$ grep -rnE "capability:\s*(BILLING_MANAGE|BILLING_PURCHASE|ORGANIZATION_MANAGE|INTEGRATION_MANAGE|API_KEY_MANAGE|CAMPAIGN_EXECUTE|CAMPAIGN_DELETE|CONTENT_PUBLISH|CONTENT_DELETE)\b" pages/api/super-admin/
grep exit=1     # no match
```

A control grep for `capability:\s*[A-Z_]+` in the same tree returns many lines (`SUPER_ADMIN_DASHBOARD_VIEW`,
`BILLING_PLATFORM_MANAGE`, `IDENTITY_ADMIN_ASSIGN`, `ORGANIZATION_DELETE`, …), so the pattern shape is
present and matchable — the shared per-tenant names simply do not occur on platform routes at
`af2fb6e9`. The rule test in §5 also pins that rule (2) fires on a fixture, so "0" is a finding, not
a silence. This is also the independent confirmation that the `purchases/complete.ts` justification
was stale.

---

## 5. Test — `backend/tests/unit/platformIsolationCheckDetector.test.ts`

Placed under `backend/tests/unit/` because `jest.config.js` sets `roots: ['<rootDir>/backend']` and
`npm test` runs `jest backend/tests`. It follows the repository's existing convention for unit-testing
a CI-gate script — `backend/tests/unit/routeAuth001Scanner.test.ts` and
`backend/tests/unit/routePolicyInventoryScript.test.ts` — i.e. `require()` the script and exercise its
exported scan functions against inline fixtures.

```
$ cd /c/tmp/dt5-sec && CI=true node node_modules/jest/bin/jest.js \
    backend/tests/unit/platformIsolationCheckDetector.test.ts --runInBand --forceExit

PASS backend/tests/unit/platformIsolationCheckDetector.test.ts (18.599 s)
  L-01 — rules and allowlist are keyed on repo-relative paths
    √ toRepoRelative strips the repository prefix and normalises separators (12 ms)
    √ rule (1) fires on a repo-relative super-admin path (it could not before) (3 ms)
    √ rule (1) does NOT fire on an absolute path — the old, broken input shape (2 ms)
    √ rule (2) fires for a per-tenant capability on a platform route (1 ms)
    √ the allowlist suppresses by repo-relative path (2 ms)
    √ rule (3) still tolerates tests and scripts under the relative convention (1 ms)
    √ every reported hit carries a repo-relative path, never an absolute one (2093 ms)
  L-02 — overlapping scan roots scan each file exactly once
    √ collectFiles returns no duplicate paths despite nested roots (955 ms)
    √ adding a root already subsumed by another does not change the file set (1149 ms)
    √ a file under a doubly-covered root appears once in the report (1846 ms)
  L-03 — the stale allowlist entry is gone
    √ super-admin/purchases/complete.ts is no longer allowlisted (1 ms)
  the previously proven false negative is now detected
    √ pages/api/super-admin/creator-operations.ts is reported as a legacy-facade user (14 ms)
    √ the full run reports it exactly once (2167 ms)

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

**13 tests, 13 passed, 0 failed, 0 skipped.** The three behaviours the task required to be pinned are
each covered: allowlist matching on repo-relative paths; each file counted once; a known
super-admin-identity usage detected.

Counts measured through the exported API in the same tree:

```
filesScanned 2454
total hits 14   distinct (file:line:category) keys 14
{"role_equality":13,"super_admin_user_legacy":1}
allowlist size 7
collectFiles distinct? true
```

`total hits == distinct keys` is the de-duplication invariant holding on the real tree.

### 5.1 Harness notes, stated plainly

- `CI=true` was set because `backend/tests/setupEnv.ts:33-41` refuses to run without a
  non-production env file and **no `.env*` file was created or read** — the prohibition on reading
  credentials and `.env*` was honoured, and `setupEnv.ts` documents `CI=true` as the hermetic path.
  The suite under test requires no environment variable of its own.
- `node_modules` was joined into the worktree as a directory junction to `C:/virality/node_modules`
  (the worktree has none of its own). `node_modules` is gitignored (`.gitignore:1`), so it does not
  appear in `git status`.
- The run emits a pre-existing `[config] Fatal: Configuration initialization failed` **console.error**
  from `backend/tests/globalTeardown.ts:49` → `lib/redis/usageProtection.ts` → `config/index.ts:237`,
  because the hermetic `CI=true` invocation supplies no `REDIS_URL` / `OPENAI_API_KEY` /
  `ENCRYPTION_KEY`. It is logged during teardown, is unrelated to this change, and did not fail the
  suite (`1 passed, 1 total`). Recorded here rather than hidden.

---

## 6. Residual limitations of the detector — still present after this batch

Fixing the three defects did not make the detector sound. What remains:

1. **It is line-oriented and textual.** `scanSource` tests one line at a time with regexes, so a call
   split across lines (`await requireSuperAdminUser(\n  req, res)`), a renamed import
   (`import { requireSuperAdminUser as gate }`), a computed capability
   (`capability: CAPS.BILLING_MANAGE`) or a capability passed through a variable all evade it. There
   is no AST, no import resolution and no scope analysis.
2. **Comments and strings are not excluded.** The allowlist comment at the four migrated
   super-admin routes exists *because* of this: those files mention `requireSuperAdminUser` only in
   prose, and the only available remedy is to exempt the whole file. That means a genuine
   regression re-introduced into one of those four files would be suppressed. Stripping comments
   before matching would let all four entries be removed — a real improvement, out of this batch's
   scope.
3. **Rule (2)'s capability list is a hardcoded literal set** (`SHARED_CAP_NAMES`, 9 names) maintained
   by hand and not derived from `backend/security/platformCapabilities.ts`. It drifts silently as
   capabilities are added. It also only matches the `capability: NAME` object-property shape.
4. **Rules (1) and (2) are gated on the `pages/api/super-admin/` path prefix**, so a platform route
   mounted anywhere else is invisible to them, and a platform-authority service reached from a tenant
   route is invisible to all three.
5. **Three of the seven remaining allowlist entries are structurally inert.**
   `pages/api/team/self-joined.ts`, `pages/api/virality/playbooks/index.ts` and
   `pages/api/virality/playbooks/[id].ts` are allowlisted for shared-capability use, but the only
   shared-capability rule is rule (2), which is gated on the super-admin prefix these three do not
   have. They suppress nothing even now. Per the inventory's L-03 they were reported as no-op, not
   stale; the task's mandate named only the `purchases/complete` entry, so they were **left in
   place**. Removing them is a follow-up, not a defect introduced here.
6. **`pages/api/super-admin/users.ts` is also stale by the inventory's own test** (L-03 records 0
   `requireSuperAdminUser` mentions, re-confirmed here). Its removal would not change today's report,
   because rule (1) has nothing in that file to match. **Not pruned** — the mandate named one entry,
   and a second prune is a judgement call the owner should make alongside item 2 above. Offered as an
   option, not taken.
7. **It exits 0 always and gates nothing.** Still no `package.json` script, no workflow. It reports;
   nothing compels anyone to read it. See §8.
8. **Zero-hit categories are not distinguished from disabled ones in the output.** The `before` report
   was indistinguishable from a clean one — that was the whole L-01 exposure. The output format is
   unchanged in this respect: a category with no hits is still simply absent. Printing
   `[category] (0)` explicitly would make a future breakage self-evident. Out of scope here;
   recommended.
9. **`role_equality`'s 13 hits are untriaged.** Several are in UI/visibility positions
   (`pages/admin/users.tsx`, `components/CompanyContext.tsx`) where a literal comparison may be
   acceptable; two are in `pages/api/**` authorization positions. This document makes **no claim**
   about any of them. That triage is the point of having a working detector and has not been done.

---

## 7. What was deliberately NOT touched, and why

**Nothing outside `scripts/platform-isolation-check.ts` and the one new test file was modified.**
`git status --short` in the worktree shows exactly the script (`M`), the test (`??`) and this document
(`??`).

| Left untouched | Why |
|---|---|
| **The unvalidated role-write path** — `backend/services/userManagementService.ts` (`:83`, `:95`, `:99-104`, `:161`), `pages/api/users/invite.ts`, `pages/api/users/[userId]/role.ts` (inventory **L-04**) | Needs an owner **deployment decision**: adding role-value validation makes writes that currently succeed start failing. Out of scope for Batch 1 |
| **The unreachable `Role.ADMIN` comparison** — `backend/services/userManagementService.ts:27` (inventory **L-05**) | **Ordering hazard, and the reason this batch stops here.** That dead comparison is currently the only thing preventing L-04 from being a live **company-admin → platform-super-admin escalation**: it 403s every non-super-admin requester, including legitimate company admins, so no company admin can reach the unvalidated `role` write. **Fixing it first would OPEN that escalation.** L-04 must land before L-05, in one reviewed PR, with an owner deployment decision |
| **The `ADMIN` / `COMPANY_ADMIN` normalisation convention** — `pages/api/company/users/[userId]/role.ts:8-13`, `:40` vs `rbacPrimitives.ts:32` | The two routes carry opposite conventions. Choosing one is a product decision and it is entangled with L-05 above |
| **The 403-vs-404 oracle** | Out of scope by instruction; it is a disclosure-surface decision, not a detector defect |
| **`scheduled_posts.company_id`** (inventory **L-06**) | Migration + backfill against live data; needs a read-only production listing first, which this stream has no access to. **BLOCKED on operator input** |
| **Any migration**, including the `user_company_roles.role` CHECK constraint | Same reason. No `supabase/migrations/**` file was created, read for modification, or applied. No database was contacted |
| **CI wiring** | Explicitly an owner decision — it begins gating pull requests. **Recommended, not done.** See §8 |
| **`research/cpg-u1/**`, `C:/tmp/dt002`, every other worktree** | Untouched. This worktree's only `research/` addition is this document under the new `research/deeptech-operations/security/` path |
| **Product runtime behaviour** | Unchanged. `scripts/platform-isolation-check.ts` is developer tooling: nothing in `pages/`, `components/`, `backend/` or `lib/` imports it (finding 4: its only three references in the repository are to itself), and it is not in any build, worker or request path. No authorization logic was altered anywhere |

---

## 8. Next unlock — what the owner must decide

1. **Batch 2 deployment decision (blocking, HIGH).** Approve L-04 → L-05 **in that order, in one
   PR**. Specifically: (a) is it acceptable that role writes currently succeeding with a
   non-canonical string begin to fail 400? (b) which normalisation convention wins,
   `ADMIN → COMPANY_ADMIN` or `COMPANY_ADMIN → ADMIN`? (c) confirm the reviewer will see both halves
   together. **Until that decision exists, L-05 must not be fixed alone.**
2. **CI wiring for this detector (recommended, not done).** The report is now trustworthy enough to
   gate on. Suggested shape: add an npm script (`"check:platform-isolation": "tsx
   scripts/platform-isolation-check.ts"`), decide whether it exits non-zero on new hits, and baseline
   the current 14 so the gate catches additions rather than the existing backlog. This begins gating
   pull requests — owner's call.
3. **Triage the 13 `role_equality` hits and the 1 `super_admin_user_legacy` hit.** The
   `creator-operations.ts:43` hit is what rule (1) exists to find and has never been seen before. It
   needs a decision: migrate to `requireCapability` + platform-tier capability, or allowlist with a
   justification that is tested.
4. **Optional detector hardening**, each independently safe: strip comments before matching (would
   retire the four comment-only allowlist entries), derive `SHARED_CAP_NAMES` from
   `platformCapabilities.ts`, print `[category] (0)` for empty categories, prune the three inert and
   one further stale allowlist entries (§6 items 5 and 6).
5. **Operator-only items**, unblocked by nobody here: the read-only production listing of distinct
   `user_company_roles.role` values (prerequisite for the CHECK constraint) and of
   `scheduled_posts` tenancy (L-06); and closing L-08 with a `vercel projects ls`.

---

## 9. Artefact register

| Path (in `C:/tmp/dt5-sec`) | Class | State |
|---|---|---|
| `scripts/platform-isolation-check.ts` | **ENGINEERING ARTIFACT** | **IMPLEMENTED**, modified, uncommitted |
| `backend/tests/unit/platformIsolationCheckDetector.test.ts` | **ENGINEERING ARTIFACT** | **IMPLEMENTED** and **VERIFIED** (13/13 pass), new, uncommitted |
| §2 / §4 detector output | **EXECUTION EVIDENCE** (detector only — **not** a security assurance) | **VERIFIED** — both runs executed |
| §5 test output | **EXECUTION EVIDENCE** | **VERIFIED** — executed |
| §1 re-verification table | **ANALYTICAL RESULT** | **VERIFIED** at `af2fb6e9` |
| §6 residual limitations, §8 next unlock | **ANALYTICAL RESULT** | — |
| §8 items 1 and 2 (Batch 2 approval, CI wiring) | **HUMAN-REQUIRED INPUT** | **DEFERRED / BLOCKED on owner** |
| Batch 2 (L-04, L-05) and Batch 3 (L-06, CHECK constraint) | — | **DEFERRED** (Batch 2, owner decision) / **BLOCKED** (Batch 3, operator database access) |
| This document | **REGISTERED ARTIFACT** | new, uncommitted |

No item here is a **REGISTERED ARTIFACT** of DeepTech evidence; none touches `research/cpg-u1/**`.

Statuses not used and why: **NOT RUN** — both detector runs and the test suite were executed, so
nothing in this document rests on an unexecuted check; **UNVERIFIED** — every claim is backed by a
command shown above. No check anywhere in this document is described as PASS without its output.

---

*Worktree `C:/tmp/dt5-sec` is **DISPOSABLE** and detached at `af2fb6e9`. Nothing was committed,
pushed or opened as a PR. No network call, no database access, no `.env*` or credential read, no
migration, no CI change, no product runtime change.*
