/**
 * C10 (2026-11-11, owner decision): count a block template's use.
 *
 * Called EXACTLY ONCE from each "use this template" action (blog, newsletter,
 * managed template pages), and only when the chosen template is a SAVED one
 * (built-in layouts are code, not rows, and have no count). `keepalive` lets the
 * request finish although the page navigates away immediately after. A failure
 * is reported (console.error with the template id and status), never swallowed;
 * it does not block the user's navigation, because a usage counter must not
 * stop someone writing.
 *
 * BROWSER-ONLY (lives in lib/client/): the browser issues this same-origin
 * relative /api request, so it is not a server SSRF surface. Never import it
 * from backend/** or pages/api/** - the server uses blockTemplateService.
 */
export function recordBlockTemplateUse(
  companyId: string | null | undefined,
  templateId: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!companyId || !templateId) return Promise.resolve(false);
  const url = `/api/block-templates/${encodeURIComponent(templateId)}?company_id=${encodeURIComponent(companyId)}`;
  return fetchImpl(url, { method: 'POST', credentials: 'include', keepalive: true })
    .then((res) => {
      if (!res.ok) {
        console.error('[block-template-usage] use NOT recorded', { templateId, status: res.status });
        return false;
      }
      return true;
    })
    .catch((err: unknown) => {
      console.error('[block-template-usage] use NOT recorded', { templateId, error: err instanceof Error ? err.message : String(err) });
      return false;
    });
}
