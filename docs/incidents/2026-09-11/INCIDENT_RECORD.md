# Incident 2026-09-11 — production-connected local worker: evidence record

Preserved 2026-09-13 ~21:40Z (2026-09-14 03:10 IST) on the new laptop (user `lenovo`).
Nothing in this directory is part of any git commit.

## Boundary

```text
INCIDENT:
Production-connected worker executed two cron tasks.

D8/DG-001:
Certified independently and unaffected.
```

The D8/DG-001 commit on `recon/six-workstream-union` contains only the 9 certified
code/test/mutation-script files. No incident remediation, evidence, or config is in it.

## Where the incident happened

On the OLD laptop (profile `Admin`), before the migration. This laptop's Docker Desktop was
installed fresh at 2026-09-11T20:54Z (`current-host-docker-desktop/log/host/DockerDesktopInstaller.exe.log`),
after the 02:23Z run. On the current host, `omnivyra-worker`, `omnivyra-redis` and the
`virality-worker` image do not exist (`current-host-container-state/`). No container event
naming omnivyra/virality/worker/redis occurred since this Docker install (245 container events checked).

The old host's Docker data survives only in the copied old profile:
`C:\Users\Admin\AppData\Local\Docker\wsl\disk\docker_data.vhdx` (46,110,081,024 bytes, last
modified 2026-09-11T06:00:22Z). It holds the worker container (config, json log), the
`omnivyra-redis` container and its data volume, and the `virality-worker` image. It has been
copied here (`old-host-docker-desktop/wsl-disk-images/`) and was NOT mounted or opened.

## Timeline (UTC)

| Time | Event | Source |
|---|---|---|
| 2026-09-09 07:07:19.767Z | cron stamp `intelligencePolling` | `prior-session-captures/cron_state.txt` |
| 2026-09-10 11:55:54Z | Docker Desktop backend exit/relaunch | `old-host…/log/host/Docker Desktop.exe.log` |
| 2026-09-10 11:58:42Z | container `ccb229b1690d` (`/omnivyra-worker`) running | backend log rotation since deleted by Docker; line survives only in `session-transcripts/5bf7be72-….jsonl` |
| 2026-09-10 11:59:12–14Z | cron stamps `governanceAudit`, `performanceAggregation`, `intelligenceEventCleanup`, `engagementSignalArchive` | `cron_state.txt` |
| 2026-09-11 02:21:56Z | Docker Desktop launched (certifying session) | old-host logs |
| 2026-09-11 02:23:15.69Z | `exposer.Add(ccb229b1…, /omnivyra-worker, 8080)` | `old-host…/log/host/com.docker.backend.exe.log.20260911-101959.245` line 2826 |
| 2026-09-11 02:23:20.28Z | `exposer.Add(0528e324…, /omnivyra-redis, 6379)` | same file, line 2846 |
| 2026-09-11 02:23:42.433Z | cron stamp `leadThreadQueueCleanup` (RPC `cleanup_lead_thread_recompute_queue_orphans`, deletes orphan rows) | `cron_state.txt` |
| 2026-09-11 02:23:42.548Z | cron stamp `confidenceCalibration` (reads outcomes; may upsert calibration) | `cron_state.txt` |
| 2026-09-11 02:27:04.17Z | `exposer.Remove(ccb229b1…)` — worker stopped | same backend log |
| 2026-09-11 03:31:11Z | Redis `TIME` at capture of `omnivyra:cron:last_run_state` | `cron_state.txt` line 1 |

Container IDs: worker `ccb229b1690d9487b526ebddba05df8df487295b8d019b8773d7005bafb8060c`,
redis `0528e3240bd8d71b9f8e1b4a6da81fbb52d058e47df7969b352f8575db958b65`.

## `omnivyra:cron:last_run_state`

The live key is not reachable: the `omnivyra-redis` container does not exist on this host.
Preserved forms:
1. `prior-session-captures/cron_state.txt` — the key's value captured 2026-09-11T03:31:11Z
   (line 1 = Redis `TIME`, line 2 = the JSON map).
2. `prior-session-captures/redis_idle.txt` — per-key idle-time listing captured 03:30:03Z.
3. The Redis data volume inside the preserved `docker_data.vhdx` (not extracted).

## Contents

| Folder | What |
|---|---|
| `old-host-docker-desktop/log/` | Full old-host Docker Desktop `log/host` + `log/vm` (77 files), incl. the 2026-09-10 and 2026-09-11 rotations |
| `old-host-docker-desktop/wsl-disk-images/` | Old-host `docker_data.vhdx` + `ext4.vhdx` (unopened) |
| `old-host-docker-desktop/{local-root,tasks,roaming}/` | Old-host install logs, task PIDs, Docker settings |
| `prior-session-captures/` | `worker_all.log` (worker `docker logs`, silent since 2026-07-09), `worker_window.log` (0 bytes), `cron_state.txt`, `redis_idle.txt` |
| `session-transcripts/` | Certifying/incident session transcript `5bf7be72-…` (only surviving record of the 09-10 11:58:42Z log line) |
| `current-host-docker-desktop/log/` | Current-host Docker Desktop logs (live snapshot) |
| `current-host-container-state/` | `docker ps -a`, filters, images, volume inspect, container events since install — captured read-only |

Checksums: `MANIFEST.sha256.csv` (original path, copied path, sizes, timestamps, both hashes,
verdict) and `MANIFEST.sha256sums.txt`.

`C:\virality\docker-compose.yml` was not copied or touched; recorded only:
sha256 `90ccfe94e8f813bc4d1c0e94a9ca8d7a51effc62444f6152fbd16f3e889d1da3`, mtime 2026-05-23T04:13:27Z.

## Known gaps

- The old-host backend log rotation covering 2026-09-10 11:55–13:29Z was deleted by Docker's
  log rotation before preservation. Only the transcript excerpt remains.
- Whether either cron task changed production data cannot be established without production
  reads, which were not performed.
- `C:\Users\Admin` is the only other place these originals exist. Do not delete it without
  first confirming this directory is intact (compare against `MANIFEST.sha256.csv`).

## Safety during preservation

No container was started, stopped, removed, or updated. No Redis command was run. No
production database, RPC, or Supabase API was contacted. `C:/virality` was not modified.
