# Runtime Reachability Resolution Report

Runtime reachability:
PARTIAL

## Implemented
- Reachability uses explicit call graph propagation.
- Queue reachability uses queue receiver/factory/worker lineage.
- Scheduler reachability inherits execution domains only through explicit call or queue lineage.

## Remaining Reachability Gaps
- instrumentation.node.ts:51 register has no semantic reachability proof
- lib/config/verification.ts:99 testRedisConnectivity has no semantic reachability proof
- pages/api/extension/commands.ts:208 handler has no semantic reachability proof
