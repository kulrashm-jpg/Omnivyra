# Execution Dominance Completion Report

Execution dominance:
PARTIAL

## Implemented
- Transitive call-domain propagation across execution roots.
- TypeChecker declaration-file tracing for execution call targets.
- Queue dispatch lineage folded into execution-root domain propagation.
- Entrypoint delegation is no longer treated as resolved unless a real execution domain is inherited.

## Counts
- execution roots: 2432
- unresolved execution roots: 3
- unresolved dominance ambiguities: 4

## Remaining Unresolved Execution Regions
- instrumentation.node.ts:51 register reason=unresolved dynamic import execution root
- lib/config/verification.ts:99 testRedisConnectivity reason=unresolved dynamic import execution root
- pages/api/extension/commands.ts:208 handler reason=unresolved dynamic import execution root
