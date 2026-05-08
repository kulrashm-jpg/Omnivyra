# Typecheck Regression Report

Observed command:
- npx tsc -p tsconfig.json --noEmit --pretty false --incremental false

Observed result:
- Timed out after 180s during final validation.
- Earlier timeout at 300s occurred after RedisClient type export was missing; that specific error was from moving RedisClient to lib/redis/types without preserving the public type export from lib/redis/client.

Current forensic conclusion:
- No final TypeScript diagnostic list was produced after timeout.
- Timeout correlates with current worktree drift and expanded architecture-migration/report surface, not proven to be caused solely by alias-wrapper edits.
- Known direct typecheck regression cause from this sprint: RedisClient public type export removal; rollback-safe fix is to keep a type-only re-export from lib/redis/client or restore the prior import surface.

Blocking chains to inspect before migration resumes:
- backend/services/aiGateway.ts alias export surface
- backend/services/boltPipelineService.ts alias export surface
- backend/services/structuredPlanScheduler.ts alias export surface
- lib/redis/client.ts type export compatibility
- package script/enforcement baseline mismatch
