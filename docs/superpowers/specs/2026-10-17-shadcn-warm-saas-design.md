# shadcn/ui migration — "Warm SaaS" design

## Intent

OctoHandy should look and behave like a professional SaaS product while staying recognisably OctoHandy. Today the app has two visual languages: `oh.css` (public pages: sky gradient, pill buttons, serif everywhere, grain) and the "glass" dashboard (`globals.css`: translucent blurred cards). Both get replaced by **one** design system built on shadcn/ui, applied everywhere: public pages, auth, dashboard.

Chosen direction (user picked option A from mockups in `.superpowers/brainstorm/`): **Warm SaaS — the octopus is a signature, not the wallpaper.**

## Goals

- One token set and one component kit for every route.
- shadcn/ui (Radix-based) primitives replace hand-rolled ones, gaining keyboard/focus/a11y behaviour (focus trap in dialogs, proper switch/tabs semantics).
- SaaS structure: left sidebar navigation in the dashboard, real data tables where data is tabular, dropdown menus, tooltips.
- Brand lives at the edges: logo, empty states, loading, home hero, errors.

## Non-goals

- No changes to backend, data fetching, API, Clerk flows, i18n strings, or routes.
- No new features/pages. No dark mode (user did not ask; tokens are structured so it can be added later).
- No change to Magra's octopus drawing (`octopus-art.ts` paths are verbatim; float/blink animation stays).

## Anti-goals (failure even if it "works")

- Butter yellow leaking onto every hover/skeleton/muted surface (happens if butter is mapped to `--muted`).
- Losing the OctoHandy feel — a grey generic shadcn default.
- Breaking existing pages' behaviour while restyling.

## Design tokens (decided)

| Role | Token | Value |
|---|---|---|
| Page/card surface | `--background`, `--card`, `--popover` | paper `#fffcf3` (opaque) |
| Sidebar surface | `--sidebar` | cream, slightly darker than paper (~`#f7f2e6`) |
| Text | `--foreground` | ink `#43302e` |
| Primary button | `--primary` / `--primary-foreground` | ink / butter `#fff1b5` |
| Quiet surface (hover, skeleton, secondary button) | `--muted`, `--secondary` | neutral warm tint of ink (e.g. ink @ ~5%, opaque equivalent), **not** butter |
| Muted text | `--muted-foreground` | `#7a6461` |
| Selected / active / highlight | `--accent` / `--accent-foreground` | butter / ink |
| Illustration backdrop | `--sky` (custom) | `#c1dbe8` — only behind octopus art |
| Borders / inputs | `--border`, `--input` | ink @ ~12–14% |
| Ring | `--ring` | ink |
| Destructive | `--destructive` | `#b42318` |
| Status | success / warning tones | quiet tints (green `#e3f3ea`/`#1f6b45`, amber `#fbecd5`/`#8a5413`) |
| Radius | `--radius` | ~0.5rem (7–8px buttons/inputs); no pill buttons |

Typography: Instrument Sans everywhere (body + UI). Young Serif only for page titles (`PageHeader` h1) and public-page display headlines. Remove the global `h1–h4 { font-family: heading }` rule. Plus Jakarta Sans is loaded but unused → drop it if confirmed unused.

Removed: sky body gradient, glass-* classes, grain overlay, `btn-primary` sheen, pill nav links.

## How (decided)

- `npx shadcn@latest init` for Tailwind v4 / Next 16 / React 19; components land in `src/components/ui/` (shadcn default).
- **Facade:** current `src/components/ui.tsx` becomes `src/components/ui/index.tsx`, or is kept as the house kit re-implemented on top of shadcn primitives, so the 21 importing files keep their `@/components/ui` imports and props (`Button variant="primary|secondary|ghost|danger|blue"`, `loading`, `size`; `Card interactive`; `Modal open/onClose/title/wide`; `Toggle`; `Segmented`; `Badge tone`; etc.). Variants map onto shadcn variants; `blue` collapses into primary.
- Mapping: Modal → Dialog (bottom sheet on mobile is acceptable to drop or emulate), Toggle → Switch, Segmented → Tabs/ToggleGroup, Input/Textarea/Field → shadcn Input/Textarea/Label, Badge → Badge, Skeleton → Skeleton, Toaster → shadcn Sonner wrapper.
- Dashboard shell → shadcn `Sidebar` (collapsible, sheet on mobile), Clerk OrganizationSwitcher + user menu in it.
- Tabular lists (shops, stock, team) → shadcn `Table` where the data is a list of rows; card grids of listings with images stay grids.
- Public pages (`/`, `/explore`, `/profile`, `/chercher`, `/inventaire`, sign-in/up, join) restyled to the same tokens; `oh.css` reduced to what is octopus-specific (float/blink animation, display-headline sizes) or deleted.
- Clerk components themed via `appearance` variables to match tokens.
- framer-motion stays only where it already does meaningful motion (octopus, FadeIn); not used for dialogs (Radix + tw-animate-css handles it).

## Verification

- `npm run build` and `npm run lint` pass.
- Playwright screenshots of every route before and after (the `.playwright-mcp/` tooling exists); reviewed side by side.
- axe-core (or Playwright accessibility snapshot) on key routes: no new violations; dialogs trap focus, Escape closes.
- Contrast: text/background token pairs ≥ 4.5:1 (ink on paper, muted-fg on paper, ink on butter).

## Left to the builder

- Exact cream/muted hex values within the stated intent; OKLCH vs hex.
- Which shadcn components beyond the mapped set are worth adding (dropdown-menu, tooltip, command).
- Whether ⌘K command palette lands in this pass (nice-to-have; skip if it grows scope).
- Ordering of page migrations.

## Constraints

- Next 16.4 has breaking changes vs. training data: read `node_modules/next/dist/docs/` for anything touching Next APIs.
- Working tree on `feat/redesign` has uncommitted user changes; don't discard them.
