# Severity Tier Enforcement Report

Severity-tier enforcement: PARTIAL

## Tiers Implemented
- CRITICAL: unresolved authority/dominance, unresolved queue targets, runtime mutations outside repository, runtime payload mutation, critical transitive unsafe propagation.
- HIGH: unresolved orchestration roots, non-authoritative dominance, alias/re-export ambiguity with runtime reachability.
- MODERATE: local aliasing, non-critical authority overlap, local unsafe propagation.
- LOW: safe repository-owned or local-only findings.

## Enforcement Behavior
- --enforce exits non-zero when CRITICAL findings exist.
- Baseline normalization is not performed.
- Findings are emitted to severity-tier-findings.json.

## Current Tier Counts
- CRITICAL: 4633
- HIGH: 509
- MODERATE: 0
- LOW: 0
