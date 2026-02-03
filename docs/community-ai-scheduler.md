Community-AI Scheduler

## Purpose
The scheduler executes scheduled Community-AI actions where `status = scheduled` and `scheduled_at <= now`. Each action is routed through the Action Executor and audit logs are written for execution outcomes.

## How to run manually
Command:
node scripts/communityAiScheduler.ts

## How to run with cron (Linux/Mac)
Example:
*/5 * * * * cd /path/to/virality && node scripts/communityAiScheduler.ts >> logs/community-ai-scheduler.log 2>&1

## How to run with Windows Task Scheduler
Steps:
- Program: node
- Argument: scripts/communityAiScheduler.ts
- Start in: C:\virality
- Trigger: every 5 minutes

## Safety notes
- Requires DB access
- Tenant-scoped enforcement is applied
- No social platform APIs are called yet (stub connectors only)
- Audit logs are written for each execution
- Scheduler logs are written to logs/community-ai-scheduler.log
- Ensure the logs/ directory exists and is writable
