# Execution Ownership Verification

Status: DUPLICATE ORCHESTRATION OWNER COUNT IS 0 BY CURRENT TOOLING, BUT NOT FULLY TRUST-PROVEN.

## Ownership Classes
- canonical-owner: 8
- queue-entrypoint: 1
- adapter/delegator: 1

## Domains Scanned
- recommendations: 8
- contentGeneration: 1
- campaignExecution: 1

## Violations
- none

## Hidden Ownership Risks
- API and queue entrypoints are present and currently classified as entrypoints/delegators, not owners.
- Symbol aliases are explicitly present for campaign/content/scheduling flows. Current scanner counts final exported symbols but does not prove the aliased implementation is only one runtime path.
- Local differently named coordinators are outside the duplicate-owner symbol list and can hide orchestration forks.
- Recommendation, content generation, AI execution, campaign execution, and scheduling require call-graph verification before debt elimination, not just symbol classification.

Verdict: no detected duplicate owners; hidden shadow coordinators are not fully excluded by current tooling.
