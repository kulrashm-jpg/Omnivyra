/**
 * Dead-lettered CMS publishes: what the operator sees, and the retry they can take (e9, pre-launch).
 * Pure + injectable (fetch, confirm), so the decision logic is tested without a browser.
 *
 * An OUTCOME-UNKNOWN job (the post may already be live) retries only after the operator confirms,
 * and the confirmation shows the EVIDENCE - the CMS, its last answer and when - so they can actually
 * decide rather than click through (05). The server refuses an unconfirmed retry too.
 */
export type PublishingIssue = {
  job_id: string;
  blog_id: string | null;
  provider: string;
  job_type: string;
  dead_letter_at: string;
  last_error: string | null;
  outcome_unknown: boolean;
  last_attempt: { status: string; error_message: string | null; started_at: string | null; finished_at: string | null } | null;
};

const when = (iso: string | null | undefined): string => {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/** The evidence lines shown on the card and in the confirmation. */
export function publishingIssueEvidence(issue: PublishingIssue): string[] {
  const a = issue.last_attempt;
  return [
    `CMS: ${issue.provider}`,
    `Last attempt: ${a ? `${a.status} at ${when(a.finished_at ?? a.started_at)}` : 'none recorded'}`,
    `CMS answer: ${a?.error_message ?? issue.last_error ?? 'none recorded'}`,
  ];
}

export function publishingIssueTitle(issue: PublishingIssue): string {
  return issue.outcome_unknown
    ? 'Publish outcome unknown - the post may already be live'
    : `Publishing to ${issue.provider} failed`;
}

/** The confirmation text for an outcome-unknown retry; null when no confirmation is needed. */
export function retryConfirmText(issue: PublishingIssue): string | null {
  if (!issue.outcome_unknown) return null;
  return [
    'This post may ALREADY be live on your site. Retrying could publish it a second time.',
    'Check your site first. Retry only if the post is NOT there.',
    '',
    ...publishingIssueEvidence(issue),
    '',
    'Retry anyway?',
  ].join('\n');
}

export type RetryOutcome = { ok: true } | { ok: false; cancelled?: true; message: string };

export async function retryPublishingIssue(
  issue: PublishingIssue,
  companyId: string,
  deps: { fetch: typeof fetch; confirm: (text: string) => boolean },
): Promise<RetryOutcome> {
  const confirmText = retryConfirmText(issue);
  if (confirmText !== null && !deps.confirm(confirmText)) {
    return { ok: false, cancelled: true, message: 'Retry cancelled.' };
  }
  const res = await deps.fetch(`/api/blogs/publishing-jobs/${encodeURIComponent(issue.job_id)}/retry`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, confirm_outcome_unknown: confirmText !== null }),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (res.ok && (data as { retried?: boolean }).retried === true) return { ok: true };
  return { ok: false, message: String((data as { error?: string }).error ?? 'Retry failed. Please try again.') };
}
