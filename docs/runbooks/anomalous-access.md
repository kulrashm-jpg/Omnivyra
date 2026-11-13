# Anomalous-access alerts — response notes

Recipient: kuldeep@omnivyra.com (Grafana → email, alerting on the Loki line `event="anomalous_access"`).
Source: `backend/services/security/anomalousAccessDetector.ts`, scheduled every 5 min over a 10-min window by
`backend/jobs/anomalousAccessScanJob.ts`. Each alert carries `rule`, `actor_user_id`, `count`, `threshold`.
The same rule + actor alerts at most once per hour (cooldown); a second alert within a week for the same rule is
worth reading even if each one looked benign.

## First, for every alert
1. Open Loki: `{app="worker"} |= "anomalous_access"` around the alert time. Note `rule`, `actor_user_id`, `count`.
2. Who is the actor? `select id, email from public.users where id = '<actor_user_id>'` (and `auth.users` for the
   same id - writers record both id spaces). Read-only.
3. What did they do? `select action, target_user_id, company_id, created_at from audit_logs where actor_user_id =
   '<actor>' and created_at > now() - interval '30 minutes' order by created_at` (R3: `capability_audit_log` by
   `occurred_at`; credit actions: `super_admin_audit_logs`).
4. Record the outcome (true positive / false alarm + why) - three false alarms of one rule in a week is a
   RE-BASELINE trigger, not something to mute.

## Per rule

### R1a bulk_membership_growth (>= 12 invites / 10 min)
- Question: is one actor adding members unusually fast?
- False alarm looks like: a known customer onboarding a team; invites go to one company, to plausible addresses.
- Real one needs: invites spread across companies, or to throwaway domains, or an actor who is not that
  company's admin → suspend the actor (super-admin suspend), revoke the pending invitations.

### R1b sensitive_privileged (>= 4 / 10 min: role changes, deactivations, removals, domain, policy, SUPER_ADMIN_*, credits)
- Question: is someone doing the things an attacker does after getting in?
- False-alarm check FIRST: does this coincide with a bulk invite (R1a-type actions) by the same actor? Onboarding
  sets several roles - that is explainable.
- Real one needs: role ELEVATIONS to admin, deactivations of other admins, credit grants, domain reassignment →
  force-logout + suspend the actor, then review every action in the window.

### R2 denial_burst (>= 5 denials / 10 min)
- Question: is someone probing for things they are not allowed to do?
- False alarm looks like: a new user clicking around a screen their role cannot use (2-3 denials, same screen).
- Real one needs: denials across many different actions / companies (a script) → suspend, check the session's IP.

### R3 stepup_failure_burst (>= 5 failed TOTP / passkey / step-up / 10 min)
- Question: is someone guessing a second factor?
- False alarm looks like: the account owner fumbling TOTP then a recovery code, then succeeding.
- Real one needs: failures with no later success, or from an unfamiliar device/IP → force-logout, reset MFA with
  the owner out of band.

### R4 privileged_actor_not_allowlisted (any privileged action by an actor outside AUDIT_PRIVILEGED_ACTOR_IDS)
- STEP ONE (resolves the common benign case in seconds): check the allowlist config's recent history - was this
  actor added to `AUDIT_PRIVILEGED_ACTOR_IDS` but not yet deployed, or was an admin onboarded without the config
  being updated? If yes: add both of their ids (public.users.id AND auth.users.id) to the config - a recorded change
  - and close as false alarm.
- Otherwise treat as COMPROMISE: an unknown principal performing privileged actions → force-logout + suspend,
  revoke what they did, escalate to the owner immediately.
- If the run logs `anomalous_access_rule_disabled` instead, the allowlist is not configured: R4 is OFF until it is.

### R5 target_fanout (>= 15 distinct target users / 10 min)
- Question: is one actor touching everyone ("touch everything")?
- False alarm looks like: a large legitimate onboarding (check R1a for the same actor).
- Real one needs: targets across companies → suspend, review.

### R7 system_unexpected_action (SYSTEM performing a privileged action outside its expected set)
- Question: did something running as SYSTEM do a privileged thing it has never done?
- False alarm looks like: a NEW automated flow that legitimately does this - then add it to
  `SYSTEM_EXPECTED_PRIVILEGED_ACTIONS` WITH a written reason (a reviewed code change), never under alert pressure.
- Real one needs: no known flow explains it → treat as compromise of a service path; escalate.

### synthetic_trip (action `ANOMALOUS_ACCESS_SYNTHETIC_TRIP`)
- A deliberate test (83, owner-approved): proves the chain log line → Loki → Grafana → this inbox. Expected; reply
  to 83 that it arrived. Repeat after any change to the pipeline.

## The heartbeat
`anomalous_access_scan` every run: `rules_run`, `rules_disabled`, `rules_failed`, `sources_failed`, `findings`,
`oldest_threshold_basis_age_days`, `fires_7d`. Absence of the heartbeat = the detector is not running (absence
alert). `rules_failed` / `sources_failed` non-empty = it ran but could not see part of its input - not "quiet".
