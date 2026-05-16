# Deploy Traceability (omnivyra)

Vercel is **manual-CLI-only** for this repo — `vercel.json` sets
`git.deploymentEnabled: false`. Vercel records **no Git commit metadata**
on a CLI deploy, so traceability is enforced by convention, not the platform.

## Before every production deploy

```bash
npm run predeploy:check
```

This **blocks if the working tree is dirty** (you must never ship a snapshot
that has no corresponding committed, pushed SHA) and prints the exact commit
plus the deploy-tag command to run afterward. It never deploys and never
creates a tag itself.

## Deploy + record (manual)

1. `npm run predeploy:check` → must say `RESULT: OK`.
2. Ensure the commit is pushed to its remote branch.
3. Deploy manually: `vercel --prod` (your action — not automated).
4. After the deploy reports **Ready**, tag the exact deployed commit:

   ```
   git tag -a deploy/omnivyra-YYYYMMDD-HHMM <short-sha> -m "omnivyra prod deploy YYYYMMDD-HHMM"
   git push origin deploy/omnivyra-YYYYMMDD-HHMM
   ```

5. Confirm parity: `vercel inspect <deployment-url>` corresponds to that SHA.

## Tag convention

`deploy/omnivyra-YYYYMMDD-HHMM` — one annotated tag per production deploy,
pointing at the exact deployed commit. These tags are the audit trail and the
rollback index ("last known good" = previous `deploy/omnivyra-*`).

## Rules

- No auto-deploy; no Vercel workflow changes. This is documentation +
  a read-only guard only.
- Never deploy from a dirty tree or an unpushed commit.
- One deploy = one `deploy/omnivyra-*` tag, always pushed.
