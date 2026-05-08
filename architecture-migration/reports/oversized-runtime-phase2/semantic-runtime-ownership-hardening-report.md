# Semantic Runtime Ownership Hardening Report

Enforcement changes added:
- Persistence detector narrowed to concrete Supabase/DB/table mutation chains.
- Rendering detector narrowed to React/JSX markers instead of TypeScript return/generic syntax.
- Queue detector narrowed to concrete queue/BullMQ/worker/processor dispatch surfaces.
- Authority detector narrowed to explicit authority and authorization surfaces.

Effect:
- Dangerous oversized runtime regions reduced from 96 to 59.
- Mixed orchestration/persistence regions reduced from 62 to 22.
- Mixed queue/scheduler/mutation regions reduced from 42 to 16.
- Mixed authority/execution regions reduced from 83 to 41.
