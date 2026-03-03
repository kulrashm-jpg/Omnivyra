# Radar as Default Campaign Landing (Management Roles)

Role-based default center view for the execution layout. User choice is preserved when they switch view (optional persistence).

---

## 1. Routing logic

- **No route change.** The execution layout is the same page; only the **center view** (Radar vs Pipeline) changes.
- **Initial view** is resolved in order:
  1. **Stored preference** — if `persistCenterView` is true and `sessionStorage['virality:execution:centerView']` is `'radar'` or `'pipeline'`, use it (user’s last choice).
  2. **Role-based default** — if `userRole` is provided: COMPANY_ADMIN or CAMPAIGN_CONTENT_MANAGER → **Radar**; CONTENT_CREATOR (and any other role) → **Pipeline**.
  3. **Prop fallback** — else use `defaultCenterView` (default `'pipeline'`).

---

## 2. Role-based default logic

| Role                      | Default center view |
|---------------------------|----------------------|
| COMPANY_ADMIN             | Radar                |
| CAMPAIGN_CONTENT_MANAGER  | Radar                |
| CONTENT_CREATOR           | Pipeline             |
| Any other / unspecified   | Pipeline (or `defaultCenterView`) |

Comparison is case-insensitive (e.g. `company_admin` → Radar).

---

## 3. Preserve user choice

- When the user clicks **[Radar]** or **[Pipeline]**, the layout updates state and, if `persistCenterView` is true, writes the value to `sessionStorage` under `virality:execution:centerView`.
- On next load, the stored value is read first, so the user’s last choice overrides the role-based default.

---

## 4. Navigation

Toggle order in the center panel header: **[Radar]** **[Pipeline]**.

---

## 5. Minimal implementation steps

1. **Layout (done)**  
   - `EnterpriseExecutionLayout` accepts optional `userRole` and `persistCenterView` (default true).  
   - Initial center view: stored preference → role-based default → `defaultCenterView`.  
   - On view change, optionally persist to `sessionStorage`.  
   - Toggle order: [Radar] [Pipeline].

2. **Page integration**  
   Where the execution layout is rendered (e.g. campaign execution or daily plan page):
   - Get role from context: `const { userRole } = useCompanyContext();`
   - Pass it: `<EnterpriseExecutionLayout userRole={userRole} ... />`
   - Optionally set `persistCenterView={false}` to disable storing the last view.

3. **No routing changes**  
   Same URL; only the default and persisted center view change. No new routes or redirects.
