# Design System — "Quiet Confidence"

> Long-term record of the design language and the journey-first UX introduced in the
> **Experience & Design System** phase (post-P5). For the friendly walkthrough, open
> [`docs/archive/phases/design-system.html`](../archive/phases/design-system.html).

The prototype shipped functional (P1–P5) but visually generic — Tailwind defaults plus one
indigo, and every screen rendered as a flat vertical dump of equal-weight cards. This phase gave
it an intentional design language and, more importantly, made the **staged, gated pipeline the
felt experience** rather than a data table.

Two decisions framed the work (chosen by the owner):

1. **Aesthetic — "Quiet confidence."** Calm, premium, restrained; Linear/Stripe-dashboard energy.
   The system is the product, so the chrome stays out of the way. Colour is used sparingly; depth,
   spacing and type carry the polish.
2. **Journey — re-architected.** The A→B→C→D pipeline became a visible spine: a persistent stage
   rail, a score-forward "mission control," and a single, obvious next action at every step.

---

## 1. Tokens

Tokens live in three files and nowhere else:

| Concern | File |
| --- | --- |
| Colour scales, radius, elevation, motion, fonts | [`tailwind.config.ts`](../../tailwind.config.ts) |
| Semantic surface/ink CSS variables, base styles, focus, reduced-motion | [`app/globals.css`](../../app/globals.css) |
| Status / score / rank / recommendation → colour (single source of truth) | [`lib/ui.ts`](../../lib/ui.ts) |

### Colour

Semantic surfaces and text are **CSS variables** (RGB channels, so Tailwind's `<alpha-value>`
works and dark mode is a later swap). Components never hard-code slate/white — they use these:

| Token | Value (light) | Use |
| --- | --- | --- |
| `canvas` | `247 248 251` | app background (with a whisper-faint brand halo at the top) |
| `surface` | `255 255 255` | cards, panels |
| `raised` | `248 250 252` | recessed fills inside surfaces |
| `hairline` | `226 230 236` | borders, dividers |
| `ink` | `17 24 39` | primary text |
| `ink-muted` | `71 84 103` | secondary text |
| `ink-subtle` | `148 161 179` | captions, tertiary |

**Brand** is a refined indigo scale (`brand-50…950`, 600 = `#4f46e5`), used sparingly — primary
actions, the current-stage accent, focus rings.

**Status / score tones** are a desaturated, ringed "soft badge" set (emerald / amber / rose / sky /
violet / purple / teal / slate). Every status, recommendation tier, fit score and requirement rank
maps to a tone in `lib/ui.ts` — the registry that replaced the colour maps previously **duplicated**
across `components/ui.tsx` and `app/dashboard/page.tsx`.

### Typography

Self-hosted via `next/font` (no runtime network):

- **Inter** — all UI and display. Large headings use `tracking-tight` (≈ −0.02em).
- **JetBrains Mono** — evidence ref codes (`tbl_STAR_Actions > 5-3`), step ids, raw JD text, the
  `.ref` utility.

### Radius · Elevation · Motion

- **Radius:** `field` 10px (controls), `card` 14px (panels), `xl2` 18px (heroes).
- **Elevation:** `shadow-xs`, `shadow-card`, `shadow-elevated`, `shadow-pop`, plus `shadow-glow`
  for the "current stage" emphasis. Soft, low-opacity, layered.
- **Motion:** `ease-out-soft` `cubic-bezier(.22,1,.36,1)`; `fade-in`, `fade-up`, `pop-in`
  animations. **All collapsed under `prefers-reduced-motion`** (global rule in `globals.css`).

---

## 2. Component kit

A real variant-based layer in [`components/ui.tsx`](../../components/ui.tsx). It carries **no
hooks**, so it renders in both server and client trees. Every interactive element has consistent
hover / focus-visible / active / disabled / loading states.

| Component | Notes |
| --- | --- |
| `Button` / `ButtonLink` | variants `primary · secondary · ghost · subtle · danger`; sizes `sm · md · lg`; `loading` (spinner), `leftIcon`/`rightIcon`, `block`. `ButtonLink` auto-detects external vs Next `<Link>`. |
| `Input` `Textarea` `Select` `Field` `Label` | shared field styling, focus ring, error/hint slots. |
| `Card` | hairline + `shadow-card` surface. |
| `Badge` | tone-driven soft badge (`tone` prop, not class strings). |
| `StatusBadge` | lead status → dot + label + tone, from the registry. |
| `ScorePill` | 0–10 fit score, coloured by the B6 tiers; `sm · md · lg`. |
| `Stat` | metric tile (eyebrow label, tabular value, sub). |
| `PageHeader` | eyebrow + title + subtitle + actions — used on every page. |
| `EmptyState` · `Tooltip` · `Skeleton` · `Spinner` · `Dot` | states & accents. |
| `StageRail` ([`components/stage-rail.tsx`](../../components/stage-rail.tsx)) | the journey spine. |

---

## 3. The journey model

[`lib/journey.ts`](../../lib/journey.ts) is the single brain behind "mission control." It collapses
a lead's raw `status` + score into a four-stage arc and answers three questions:

```
Capture ──▶ Screen ──▶ Tailor ──▶ Apply
```

1. **State of each stage** — `done · current · locked · upcoming` (Tailor *locks* when a lead
   screened below the bar; the rail shows the gate).
2. **The single next action** — a titled, toned CTA (`Run screening`, `Promote to tailoring`,
   `Map the evidence`, `Approve what belongs`, `Generate the CV`, `Download`…). Rendered once, in
   the hero banner; the relevant panel below it glows as "current step."
3. **Why anything is gated** — freshness hold, fit below threshold, nothing approved yet.

Because seeded leads carry a score but no explicit recommendation, the lead page derives the
recommendation from the score (`recommendationFor`) so a 7.6 reads **Proceed**, not "Unscored" —
keeping the journey honest (a [non-negotiable](../../CLAUDE.md): truthfulness over optimisation).

**Mission control** (the lead detail) is now: a score-forward hero with the rail in its footer →
the one next action → the current stage panel emphasised → screening *evidence* demoted to a calm
secondary zone. The flat dump is gone.

---

## 4. Accessibility

- **Focus:** one quiet `:focus-visible` ring on every interactive element (global rule).
- **ARIA:** `aria-current` on nav, `aria-pressed` + `aria-label` on the Keep/Maybe/Drop votes,
  labelled dashboard inputs, `role="group"` on the approval control.
- **Motion:** fully disabled under `prefers-reduced-motion`.
- **Tooltips** explain the skill-rating legend and the vote actions.
- **Responsive:** hero stacks, tables scroll, the rail stays legible down to 375px.

---

## 5. What's deliberately deferred

- **Dark mode** — the token plumbing is ready (swap the `:root` channels); not themed yet.
- **44px touch targets** — controls are 36–40px (desktop-first density); fine for the demo.
- **Real-time updates** — lead status still needs a manual refresh after long actions.
- A few status colours assume the canonical enum; unknown statuses fall back to neutral.

See the [retrospective](../RETROSPECTIVE.md) for the broader gap list.
