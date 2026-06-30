# OmniVyra Design Language (CREATOR-139)

The permanent UI foundation. **Every** screen consumes these — no screen defines its own
button/card/modal/drawer/table/toast/progress/skeleton/badge/tabs/input/header (RULE 7).

## 1. Tokens — `lib/platform/ui/tokens.ts` (the ONE source)
| Token group | Values |
|---|---|
| **Color** | `primary` 500/600/700 (`#0B5ED7` brand) · `surface`/`surface2`/`surfaceDark` · `border`/`borderStrong` · `text`/`textMuted`/`textSubtle` · `success`/`warning`/`danger`/`info` |
| **Spacing** (8px grid) | `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48 · 4xl 64` |
| **Radius** | `sm 4 · md 8 · lg 12 · xl 16 · full 9999` |
| **Shadow** | `sm · md · lg · overlay` |
| **Font size** | `xs 12 · sm 14 · base 16 · lg 20 · xl 24 · 2xl 30 · 3xl 36`; weights `400/500/600/700`; family Inter |
| **Z-index** | `dropdown 1000 · sticky 1100 · overlay 1200 · modal 1300 · toast 1400` |
| **Motion** | duration `fast 120 · base 200 · slow 320`; easing `out`/`in` |
| **Focus ring** | ONE: `2px` `primary[500]` everywhere |

**Rules:** no raw hex, no inline spacing/shadow/radius, no arbitrary Tailwind colors, no raw z-index. All values flow from tokens.

## 2. Tailwind integration — `tailwind.config.js`
Tokens are mirrored as **new named utilities** (additive; no Tailwind default overridden →
zero regression): `bg-primary-600`, `text-ink-muted`, `border-line`, `z-modal`,
`shadow-ovr-md`, `rounded-ovr-lg`, `duration-base`, `ease-ovr-out`. Legacy classes still
work; new code uses the named tokens; migration codemods map hardcoded values onto them.

## 3. Primitives — `lib/platform/ui` (the ONLY implementations allowed)
| Primitive | Import | Status |
|---|---|---|
| `Modal` | `@/lib/platform/ui` | ✅ implemented (one z-index, scrim, Escape, aria-modal, focus-return) |
| `ToastProvider` / `useToast` | " | ✅ implemented (one queue, one viewport @ `z.toast`) |
| `Skeleton` / `Progress` / `LoadingState` / `ErrorState` | " | ✅ implemented |
| Drawer · DataTable · FilterBar · ConfirmDialog · PageHeader · SectionHeader · Toolbar · SplitPanel · InspectorPanel · PreviewPanel · WizardLayout | " | ⏳ pending (same pattern: consume tokens) |
| Button · Card · Badge · Tabs · Input · Textarea · Dropdown · Section · StatsCard | `components/ui` | ✅ existing canonical (tokenize during migration) |

## 4. Interaction language (RULE 6)
- Focus: `2px primary[500]` ring (replaces indigo/blue/amber/slate).
- Modal/overlay: single z-index scale; Escape closes; focus returns; `aria-modal`.
- Loading: `LoadingState`/`Skeleton`. Empty: `components/shared/EmptyState`. Error: `ErrorState`. Success/notify: `useToast`.
- Disabled: `opacity.disabled` + `cursor-not-allowed`.
- Motion: `motion.duration.base` enter (`ease out`) / exit (`ease in`); respect `prefers-reduced-motion`.

## 5. Enforcement (RULE 8)
`node scripts/validate-design-tokens.js` reports raw-hex / arbitrary-Tailwind / raw-z-index
counts (baseline). Run `--max=N` in predeploy to ratchet the baseline down as screens
migrate. ESLint rule to add repo-wide (warn → error): `no-restricted-syntax` on inline
`#hex` string literals + an `tailwindcss/no-arbitrary-value`-style guard.

## 6. Layout & navigation (RULE 4/5) — pending
One `AppLayout` shell + `GlobalHeader` + one breadcrumb + one page-header pattern + one
action-placement rule. The token + primitive foundation here makes that rebuild mechanical.
