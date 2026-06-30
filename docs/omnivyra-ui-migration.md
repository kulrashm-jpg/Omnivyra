# OmniVyra UI Migration Toolkit (CREATOR-140)

The platform primitive library is **complete and frozen** (`lib/platform/ui`). Future UI
work is **screen migration + legacy deletion only**. Use this map.

## Component replacement map (legacy → canonical)
| Legacy pattern (CREATOR-138) | Count | Replace with |
|---|---|---|
| inline `fixed inset-0` modal | 26+ | `Modal` |
| inline side drawer/panel | 18+ | `Drawer` |
| inline progress bar | 10+ | `Progress` |
| inline table | 5+ | `DataTable` + `Pagination` |
| inline loader / `{loading?…}` | many | `LoadingState` / `Skeleton` |
| inline error text/banner | many | `ErrorState` / `useToast` |
| per-feature toast (`RewardToast`…) | several | `ToastProvider` + `useToast` |
| inline toggle "tabs" | 10+ | `components/ui/tabs` (Tabs) |
| inline confirm | several | `ConfirmDialog` |
| inline page/section header | many | `PageHeader` / `SectionHeader` |
| inline dropdown/context menu | several | `DropdownMenu` / `ContextMenu` |
| `SampleGallery` + `TemplateCard` | 2 | unify on shared gallery |
| raw `#hex` / `bg-[#…]` / `z-[100]` | 3,315 | tokens (`bg-primary-600`, `z-modal`, …) |

## Migration commands
- **Baseline / progress:** `node scripts/validate-design-tokens.js` (current: 3,315).
- **Ratchet gate (predeploy):** `node scripts/validate-design-tokens.js --max=N` — lower `N` each migration PR; CI fails on regression.
- **Foundation gate (hard, active now):** `node scripts/validate-design-tokens.js --strict-platform` — platform primitives must stay token-pure (0); wire into predeploy.

## Per-screen migration steps (mechanical)
1. Replace inline modals/drawers/tables/progress/loaders/errors with the imports above.
2. Replace raw colors → token utilities (`primary`, `ink`, `line`, `surface`, semantic).
3. Replace raw `z-[…]` / `zIndex:` → `z-modal`/`z-toast`/`zIndex.*`.
4. Run `--max` locally; confirm the count dropped; visual-diff the screen.

## Legacy disposition (PART 11) — DELETE AFTER MIGRATION
Every inline Modal/Drawer/Table/Progress/Toast/loader/error implementation, the duplicate
`ImageStockSearchPopover` (blog+content), and the `SampleGallery`/`TemplateCard` split are
marked **DELETE AFTER MIGRATION** — they remain active only until each consuming screen
adopts the canonical primitive, then are removed. No legacy primitive is canonical.

## Accessibility contract (PART 6 — built into every primitive)
Modal/Drawer/ConfirmDialog: `aria-modal`, Escape, focus-return. Menus: `role=menu`/`menuitem`,
Escape + outside-click close, keyboard-focusable. DataTable: `scope=col`, semantic `<table>`.
Forms: `<label>` association, `aria-current` on wizard step. Toast: `aria-live=polite`.
Focus ring: one token (`focusRing`). Motion respects `prefers-reduced-motion` (keyframes only).
