# Regression Diff Report

Stable counts used:
- frontend/backend imports: 0
- variant contamination: 0
- runtime cycles: 18
- runtime DB writes: 620
- unsafe any propagation: 6031

Current counts:
- frontend/backend imports: 43
- variant contamination: 43
- runtime cycles: 30
- runtime DB writes: 646
- unsafe any propagation: 6075

Regression source classification:
- frontend/backend imports: 43 records, 0 in changed files, root cause is current-worktree/baseline drift.
- variant contamination: 43 records, 16 in changed files, 27 in unchanged files; changed-file hits are pre-existing variant fields in touched services, not caused by alias exports themselves.
- runtime cycles: new cycles include platform adapter, competitor, campaignAiOrchestrator, planner, and longform cycles. These are not explained by duplicate-owner alias edits except where touched files are in existing contaminated/cyclic surfaces.
- runtime DB writes: new records relative to p0-risk-sprint are concentrated in structuredPlanScheduler.ts, boltPipelineService.ts, boltContentJobProcessor.ts, ga4/community/feature/intelligence services; repository migrations from the stable baseline are not present in current filesystem.
- unsafe any propagation: increase is mostly from API/campaign/activity-workspace files and current baseline drift; not from alias-wrapper export pattern alone.

Rollback-safe path:
- restore stable boundary and repository files first, then reapply duplicate-owner aliasing only after zero frontend/backend and zero variant contamination are restored.
