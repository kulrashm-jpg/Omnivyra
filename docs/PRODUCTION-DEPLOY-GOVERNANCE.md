# Production Deploy Governance

Authoritative deployment, builder, and schema-ledger rules for Omnivyra
production. Established during the production-closure phase (2026-05-22).

## 1. Deployment source of truth

| Plane | Authoritative source | Path |
|---|---|---|
| Web / API (Vercel `omnivyra`, www.omnivyra.com) | repo `kulrashm-jpg/Omnivyra` branch `main` | `npm run deploy:prod` (deploys **un-aliased**) → verify → `vercel promote` — see §5 |
| Worker (Railway `authentic-nature` → service `Omnivyra`) | repo `kulrashm-jpg/Omnivyra` branch `main` | Railway auto-deploy on push to `main` |

- Authoritative repo: `kulrashm-jpg/Omnivyra`. Authoritative branch: `main`.
- Deploy ONLY a clean, committed `origin/main` checkout. `scripts/predeploy-check.js`
  blocks dirty-tree / non-`origin/main` / worker-typecheck-failing deploys.
- A dirty working tree must NOT be deployed. When `main` carries in-flight WIP,
  deploy from an isolated `git worktree` of the target commit.

## 2. Builder governance

- The Railway worker MUST build with the **Dockerfile** builder
  (`Dockerfile.worker`), never RAILPACK/NIXPACKS.
- Enforced in-repo by `railway.json` (`build.builder = DOCKERFILE`,
  `dockerfilePath = Dockerfile.worker`). Any deploy that builds from the repo
  honors this.
- Known drift: the Railway **service-default** builder is `railpack`. It only
  affects deploys that bypass `railway.json` (e.g. a bare `railway up` from a
  workspace without the repo). Correct it once in the Railway dashboard:
  service `Omnivyra` → Settings → Build → Builder = Dockerfile.

## 3. Deploy-actor governance

- Exactly ONE authoritative deploy actor per plane (see §1).
- Unauthorized deploy actors are forbidden. Observed and to be removed:
  a "Codex workspace" issuing `railway up` to service `Omnivyra` — these
  bypass `railway.json`, fall back to RAILPACK, and fail. Revoke that
  workspace's Railway access / stop that agent.
- Do not run concurrent deploy agents against the same production service.

## 4. SHA divergence decision (2026-05-22)

- Railway worker SHA: `6ab41677` ("Pendig1" — full billing/editorial WIP merged
  to `main`; worker-typecheck clean; deployed `5b71f0aa` SUCCESS).
- Vercel SHA: `c83ce709` (last verified-good Vercel build).
- **Decision: divergence FROZEN, intentionally.** Vercel is NOT advanced to
  `6ab41677` until: (a) `6ab41677`'s Next.js/Vercel build is verified, (b) the
  concurrent agent is not mid-edit, (c) publishing the billing/editorial WIP to
  the public site is deliberately approved. Advancing Vercel is a deliberate,
  verified action — never a blind redeploy.
- Authoritative production SHA = `6ab41677` (`main` HEAD). Vercel lag is a
  documented, accepted divergence, not an incident.

## 5. Verified promotion gate (RELEASE-GATE-001)

**A READY deployment is not a working deployment.** On 2026-08-29 a build passed
config validation, CI, `predeploy-check` and reached READY — then answered every
request to www.omnivyra.com with 404. Nothing in the pipeline had looked at an
HTTP response, so the production alias was the first thing that exercised it.

    BUILD_READY  ≠  APPLICATION_VERIFIED
    APPLICATION_VERIFIED  →  promotion allowed

Never deploy straight to the alias. The sequence is:

```bash
# 1. Build with production env, WITHOUT touching the alias.
npm run deploy:prod                 # = predeploy-check && vercel --prod --skip-domain
                                    # note the deployment URL it prints

# 2. Verify the deployment itself over HTTP.
npm run verify:deployment -- https://omnivyra-<id>-rawats-projects-5fb9f1f3.vercel.app

# 3. Promote ONLY if step 2 exited 0.
vercel promote <deployment-url>

# 4. Confirm production.
npm run verify:deployment -- --alias
```

`scripts/verify-deployment.js` checks, against the un-aliased URL: the linked
project is `omnivyra`; `/` is 200 **and** carries `_next/static` +
`__NEXT_DATA__`; `/campaign-planner` is 200; `/api/health` returns
`{"status":"ok"}`; a static asset from that build's `buildId` is 200; and
render parity is `ok=true` with `inkRatio > 0` (the same contract as
`scripts/verify-vercel-render-parity.js`). It exits non-zero otherwise.

### Rollback

If post-promotion verification fails, restore first and investigate afterwards —
never fix forward in production:

```bash
vercel promote <previous-known-good-deployment>
npm run verify:deployment -- --alias
```

### Why the probe looks the way it does

- **Deployment Protection is `all_except_custom_domains`.** The custom domain is
  public; every `*.vercel.app` deployment URL requires Vercel login and returns
  **200 with `<title>Login – Vercel</title>` for every path, including invented
  ones**. A naive probe therefore "passes" against a totally broken deployment.
- **The bypass header alone is not enough.** `x-vercel-protection-bypass` must be
  paired with `x-vercel-set-bypass-cookie`, and the cookie must persist across
  the redirect. Node's `fetch` has no cookie jar, so `redirect: 'follow'` drops it
  and loops until `redirect count exceeded` — which looks exactly like a broken
  deployment. The script follows redirects manually and replays the cookie.
- **`vercel curl` is not used.** It produces no usable output on the pinned CLI
  (53.2.0), so it must not be the sole verification mechanism.
- **The bypass secret is read at runtime** from the authenticated CLI
  (`vercel project protection`), held in memory only. It is never printed, never
  written to a file, and never committed.

## 6. Migration ledger governance

- **Rule:** production schema MUST NOT be mutated directly without a
  corresponding migration file in `supabase/migrations/` and ledger alignment.
  Ad-hoc `ALTER`/`CREATE` against production is forbidden except as a
  migration file that is also recorded.
- The production migration ledger is known to be desynced (schema ahead of the
  recorded ledger). Until reconciled, treat the ledger as advisory and never
  bulk `db:push`.
- **Check:** run `npm run check:schema-drift` before any schema-affecting
  deploy; investigate drift before proceeding.
- Migration discipline: one change = one dated migration file; never edit an
  already-applied migration; never hand-run SQL that is not also committed as a
  migration.
