# Watcher: Design System (`design.md`)

> **Your APIs. Always in Sight.**

Companion to `PRD.md` (section 10, Frontend) and `implementation.md` (Steps 11 to 13). The PRD says what the screens contain. This file says how they look and feel.

> **Agent instructions:** Treat the tokens, recipes, and rules here as the source of truth for all frontend styling. Use Tailwind plus the CSS variables defined below. Do not add a component library. Do not invent new colors, radii, or shadows. If a component is not described here, build it from the closest recipe. Where this file and the PRD disagree about **behavior**, the PRD wins. Where they disagree about **appearance**, this file wins.

---

## 1. Design Concept

**Style:** Claymorphism on a dark, red-black base. Every interactive surface looks like soft, puffy clay lit from the **top-left**: rounded, slightly inflated, with a bright inner edge on the lit side and a deep inner shade on the far side.

**Mood:** warm, tactile, and confident, like a control panel made of glowing ember and charcoal. Calm when everything is healthy, urgent when something is down.

**Palette:** mostly shades of **red and black**. **Orange** and **yellow** are accents with specific jobs (section 2.3). No blue, green, or purple anywhere.

**The one memorable thing: the status orb.** Each monitor is represented by a large clay sphere that glows. Healthy monitors glow yellow, failing ones glow red and pulse. Everything else on the page stays quiet so the orbs read instantly. Spend the boldness there and nowhere else.

**Principles**
1. **One light source.** Highlights are always top-left, shade is always bottom-right. Never mix directions.
2. **Puffy where you touch, flat where you read.** Buttons, cards, inputs, and orbs are clay. Dense data (tables, chart plot areas) sits on flat dark surfaces *inside* a clay panel so it stays legible.
3. **Color means something.** Red and black are the brand. Yellow means healthy. Red with an icon means down. Orange means attention (paused, slow). Never use a status color as decoration.
4. **Never rely on color alone.** Every status has an icon and a text label.
5. **Restraint with shadows.** Maximum two clay levels stacked (panel, then card). Do not nest a third.

---

## 2. Color

### 2.1 Core palette (named)

| Name | Hex | Role |
|---|---|---|
| Obsidian | `#0E0506` | Page background |
| Charred maroon | `#1F0D0F` | Panels, flat data surfaces |
| Oxblood | `#3A0C11` | Deep red surfaces, borders on red |
| Crimson | `#D91E2B` | Primary action, brand |
| Ember | `#FF7A1A` | Accent: attention, charts |
| Sun | `#FFC83D` | Accent: healthy, focus ring |

### 2.2 Full scales

```text
ink (black with a red undertone)
  950 #0E0506   page
  900 #160809   page gradient end, inset wells
  800 #1F0D0F   flat panels
  700 #2B1316   clay base (shade side)
  600 #3A1D21   clay base (light side), dividers
  500 #4F2A2F   borders, disabled fill

blood (red)
  950 #1F0709   darkest red wash
  900 #3A0C11   deep red surface
  800 #5C0F18   pressed primary
  700 #8A1220   primary shade side
  600 #B3131F   primary gradient end
  500 #D91E2B   primary
  400 #F0434B   primary light side, hover
  300 #FF7A7F   soft highlight, links on dark
  200 #FFB3B5   very light tint

ember (orange)
  700 #C75A0B   shade
  500 #FF7A1A   base
  300 #FFA85C   highlight

sun (yellow)
  700 #C99410   shade
  500 #FFC83D   base
  300 #FFE08A   highlight

cream (text on dark)
  100 #FFF1EE   primary text
  300 #C9A9AA   secondary text
  500 #8F7274   tertiary text, placeholders (large or decorative use only)
```

### 2.3 Semantic mapping

| Meaning | Token | Notes |
|---|---|---|
| Page background | `ink-950` to `ink-900` gradient | With a soft red glow in the top-left corner (section 4.1) |
| Text | `cream-100` primary, `cream-300` secondary | |
| Primary button, links, brand | `blood-500` (gradient `blood-400` to `blood-600`) | |
| Monitor **up** | `sun-500` | Yellow orb, check icon, label "Up" |
| Monitor **down** | `blood-400` hot red orb with pulse | X icon, label "Down" |
| Monitor **pending** | `ink-500` dull orb with dashed ring | Clock icon, label "Pending" |
| Monitor **paused** | `ember-500` | Pause icon, label "Paused" |
| Latency chart line | `ember-500` | Area fill at 15% opacity |
| Failed check marker | `blood-400` | |
| Slow response (over 1000 ms) | `ember-300` text | |
| Focus ring | `sun-500` | Visible on every dark and red surface |
| Error text and borders | `blood-300` text, `blood-500` border | Always with an icon |
| Success toast | `sun-500` accent | |

> **Design note on status colors:** the brief limits the palette to red, black, orange, and yellow, so "healthy" is yellow and "down" is red. Because red is also the brand color, a down state is signaled by the **pulsing glow, the X icon, and the text label**, not by red alone. If you later prefer a conventional green for "up", change only the token `--status-up` in `tokens.css` (and the `up` entries in the Tailwind config). Nothing else needs to change.

### 2.4 Contrast rules
- Body text `cream-100` on `ink-800` and `ink-700` is well above 7:1.
- Secondary text `cream-300` on `ink-800` is above 7:1.
- `cream-500` is only for placeholders and non-essential hints, never for required information.
- White-ish text on `blood-500` is about 4.6:1. Therefore button labels on crimson must be **600 weight at 16px or larger**.
- Text on `sun-500` or `ember-500` fills is `ink-950`, never light text.

---

## 3. Typography

| Role | Family | Weights | Use |
|---|---|---|---|
| Display and numbers | **Fredoka** | 500, 600, 700 | Logo wordmark, page titles, card titles, big stat numbers |
| Interface and body | **Manrope** | 400, 500, 600, 700 | Everything else |

Both are rounded or soft enough to match the clay surfaces. Load them from Google Fonts with `display=swap` in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Fallback stacks: Fredoka then `ui-rounded, "Trebuchet MS", system-ui, sans-serif`. Manrope then `system-ui, -apple-system, "Segoe UI", sans-serif`.

### 3.1 Type scale (ratio about 1.25)

| Token | Size / line height | Font | Weight | Use |
|---|---|---|---|---|
| `text-xs` | 12 / 16 | Manrope | 500 | Timestamps, table metadata |
| `text-sm` | 14 / 20 | Manrope | 500 | Secondary text, table cells, form hints |
| `text-base` | 16 / 24 | Manrope | 400 / 500 | Body, inputs, buttons |
| `text-lg` | 18 / 26 | Fredoka | 500 | Card titles |
| `text-xl` | 22 / 30 | Fredoka | 600 | Section titles |
| `text-2xl` | 28 / 36 | Fredoka | 600 | Page titles |
| `text-3xl` | 36 / 44 | Fredoka | 700 | Auth page heading, large stat numbers |
| `text-4xl` | 48 / 52 | Fredoka | 700 | Stat numbers on the detail page (desktop) |

### 3.2 Rules
- **Sentence case everywhere.** No all-caps labels, no tracked-out eyebrow labels above headings.
- Numbers that change (latency, uptime, counts) use `font-variant-numeric: tabular-nums` so they do not jitter on refresh.
- Maximum line length for prose: 65 characters (error messages, empty states). Most UI text is far shorter.
- Letter spacing: `-0.01em` on Fredoka headings of 28px and up, otherwise normal.
- Do not accent one word of a heading with a different color or style.

---

## 4. Surfaces and the Clay Recipe

### 4.1 Page background
```css
body {
  background:
    radial-gradient(900px 600px at 8% -10%, rgba(217, 30, 43, 0.22), transparent 60%),
    radial-gradient(700px 500px at 100% 110%, rgba(255, 122, 26, 0.08), transparent 60%),
    linear-gradient(180deg, var(--ink-950), var(--ink-900));
  background-attachment: fixed;
  color: var(--cream-100);
}
```
No noise textures, no patterns.

### 4.2 Elevation levels

| Level | Name | Used for | Fill |
|---|---|---|---|
| 0 | Page | The background | Section 4.1 |
| 1 | Clay panel | Top bar, big containers (chart panel, auth card, modal) | Gradient `145deg`, `ink-600` to `ink-700` |
| 2 | Clay card | Monitor cards, stat tiles, buttons | Gradient `145deg`, `#46222A` to `ink-600` (one step lighter than its parent) |
| inset | Clay well | Inputs, selects, the chart plot area, toggles' tracks | Flat `ink-900`, inset shadows |
| flat | Data surface | Table rows inside a panel | `ink-800`, no shadow, 1px `ink-600` dividers |

Never nest a clay card inside a clay card inside a clay panel. If you need a third layer, make it a well or a flat surface.

### 4.3 Radii

| Token | Value | Use |
|---|---|---|
| `--r-sm` | 14px | Badges, small buttons, table container corners |
| `--r-md` | 22px | Inputs, buttons, toasts |
| `--r-lg` | 32px | Cards, panels, modals |
| `--r-pill` | 999px | Status pills, toggles, summary chips |
| `--r-orb` | 50% | Status orbs |

Clay depends on generous radii. Do not use anything under 14px on a clay element.

### 4.4 Shadow tokens (light from top-left)

Define these in `src/styles/tokens.css`. Each clay shadow combines four layers: a deep drop shadow, a faint lit-side halo, a bright inner highlight on the top-left edge, and a dark inner shade on the bottom-right edge.

```css
:root {
  /* ---------- color ---------- */
  --ink-950: #0E0506; --ink-900: #160809; --ink-800: #1F0D0F;
  --ink-700: #2B1316; --ink-600: #3A1D21; --ink-500: #4F2A2F;

  --blood-950: #1F0709; --blood-900: #3A0C11; --blood-800: #5C0F18;
  --blood-700: #8A1220; --blood-600: #B3131F; --blood-500: #D91E2B;
  --blood-400: #F0434B; --blood-300: #FF7A7F; --blood-200: #FFB3B5;

  --ember-700: #C75A0B; --ember-500: #FF7A1A; --ember-300: #FFA85C;
  --sun-700: #C99410;   --sun-500: #FFC83D;   --sun-300: #FFE08A;

  --cream-100: #FFF1EE; --cream-300: #C9A9AA; --cream-500: #8F7274;

  /* status (change --status-up here to re-skin "healthy") */
  --status-up: var(--sun-500);
  --status-down: var(--blood-400);
  --status-pending: var(--ink-500);
  --status-paused: var(--ember-500);

  /* ---------- radii ---------- */
  --r-sm: 14px; --r-md: 22px; --r-lg: 32px; --r-pill: 999px;

  /* ---------- clay surfaces ---------- */
  --clay-panel-bg: linear-gradient(145deg, #3A1D21 0%, #2B1316 100%);
  --clay-card-bg:  linear-gradient(145deg, #46222A 0%, #3A1D21 100%);

  --shadow-panel:
    18px 22px 44px rgba(0, 0, 0, 0.60),
    -8px -8px 20px rgba(255, 90, 80, 0.05),
    inset 5px 5px 10px rgba(255, 150, 140, 0.16),
    inset -7px -9px 16px rgba(0, 0, 0, 0.50);

  --shadow-card:
    12px 16px 30px rgba(0, 0, 0, 0.55),
    -6px -6px 16px rgba(255, 90, 80, 0.06),
    inset 4px 4px 8px rgba(255, 160, 150, 0.20),
    inset -6px -8px 14px rgba(0, 0, 0, 0.45);

  --shadow-card-hover:
    16px 22px 38px rgba(0, 0, 0, 0.60),
    -6px -6px 18px rgba(255, 90, 80, 0.08),
    inset 4px 4px 8px rgba(255, 170, 160, 0.24),
    inset -6px -8px 14px rgba(0, 0, 0, 0.45);

  --shadow-well:   /* inputs, plot area: pushed in */
    inset 6px 6px 12px rgba(0, 0, 0, 0.65),
    inset -4px -4px 10px rgba(255, 120, 110, 0.07);

  --shadow-pressed:  /* buttons while pressed */
    inset 5px 5px 10px rgba(0, 0, 0, 0.55),
    inset -3px -3px 8px rgba(255, 140, 130, 0.10);

  --shadow-primary:  /* crimson button, glows red */
    10px 14px 26px rgba(217, 30, 43, 0.35),
    -4px -4px 12px rgba(255, 120, 110, 0.10),
    inset 4px 4px 8px rgba(255, 190, 185, 0.45),
    inset -5px -7px 12px rgba(92, 15, 24, 0.65);

  /* ---------- motion ---------- */
  --ease-clay: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 140ms; --dur-base: 200ms;

  /* ---------- spacing: 4px base ---------- */
  /* use Tailwind's default spacing scale: 1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, 6 = 24px, 8 = 32px */
}
```

### 4.5 Utility classes (`src/index.css`, `@layer components`)

```css
@layer components {
  .clay-panel { background: var(--clay-panel-bg); border-radius: var(--r-lg); box-shadow: var(--shadow-panel); }
  .clay-card  { background: var(--clay-card-bg);  border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .clay-well  { background: var(--ink-900); border-radius: var(--r-md); box-shadow: var(--shadow-well); }
  .clay-flat  { background: var(--ink-800); border-radius: var(--r-sm); }
}
```

---

## 5. Status Orb (signature component)

A sphere built with layered gradients, so it reads as a lit clay ball. Sizes: `lg` 56px (monitor card), `xl` 96px (detail page header), `sm` 14px (table rows, inline).

```css
.orb {
  --orb: var(--status-up);          /* overridden per state */
  width: var(--orb-size, 56px); height: var(--orb-size, 56px);
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 28%, rgba(255,255,255,0.75) 0 8%, transparent 9%),   /* specular dot */
    radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--orb) 55%, white) 0%, var(--orb) 45%, color-mix(in srgb, var(--orb) 55%, black) 100%);
  box-shadow:
    8px 12px 20px rgba(0,0,0,0.55),
    inset -6px -8px 14px rgba(0,0,0,0.35),
    inset 4px 4px 8px rgba(255,255,255,0.35),
    0 0 28px color-mix(in srgb, var(--orb) 45%, transparent);  /* glow */
}
.orb[data-state="up"]      { --orb: var(--status-up); }
.orb[data-state="down"]    { --orb: var(--status-down); animation: orb-pulse 1.8s var(--ease-clay) infinite; }
.orb[data-state="paused"]  { --orb: var(--status-paused); }
.orb[data-state="pending"] { --orb: var(--status-pending); box-shadow: 8px 12px 20px rgba(0,0,0,.55), inset -6px -8px 14px rgba(0,0,0,.35), inset 4px 4px 8px rgba(255,255,255,.18); outline: 2px dashed var(--ink-500); outline-offset: 4px; }

@keyframes orb-pulse {
  0%, 100% { box-shadow: 8px 12px 20px rgba(0,0,0,.55), inset -6px -8px 14px rgba(0,0,0,.35), inset 4px 4px 8px rgba(255,255,255,.35), 0 0 18px rgba(240,67,75,.40); }
  50%      { box-shadow: 8px 12px 20px rgba(0,0,0,.55), inset -6px -8px 14px rgba(0,0,0,.35), inset 4px 4px 8px rgba(255,255,255,.35), 0 0 44px rgba(240,67,75,.75); }
}
@media (prefers-reduced-motion: reduce) { .orb[data-state="down"] { animation: none; } }
```

Rules:
- Put the matching icon inside the orb on `lg` and `xl` sizes (check, X, pause, clock), in `ink-950`, 40% of the orb size. The `sm` orb has no icon, but it always sits next to a text label.
- The orb is the only element allowed to glow. Do not add glows to anything else except the primary button's soft red halo.
- `down` is the only state that animates.

---

## 6. Components

All components follow the PRD (section 10.3) for content and behavior. This section defines appearance and states.

### 6.1 Buttons
Height 44px (minimum touch target). Radius `--r-md`. Font Manrope 600, 16px. Horizontal padding 20px.

| Variant | Fill | Text | Shadow | Use |
|---|---|---|---|---|
| Primary | `linear-gradient(145deg, var(--blood-400), var(--blood-600))` | `cream-100` | `--shadow-primary` | Add monitor, Log in, Register, Save changes |
| Secondary | `--clay-card-bg` | `cream-100` | `--shadow-card` | Check now, Edit, Cancel, Pause, Resume |
| Danger | `linear-gradient(145deg, var(--blood-700), var(--blood-900))` | `cream-100`, red icon | `--shadow-card` | Delete (confirm dialog only) |
| Ghost | transparent | `cream-300` | none | Toolbar actions, "Log out" in the top bar |

States (primary and secondary):
- **Hover:** `translateY(-2px)`, shadow increases (`--shadow-card-hover` for secondary). 140ms `--ease-clay`.
- **Active (pressed):** `translateY(1px)`, switch to `--shadow-pressed`. The button looks pushed into the surface.
- **Focus-visible:** `outline: 3px solid var(--sun-500); outline-offset: 3px`.
- **Disabled:** fill `ink-500`, text `cream-500`, no shadow except `--shadow-well`, `cursor: not-allowed`.
- **Loading:** replace the label with a small spinner (a 18px ring in `cream-100`), keep the button width, and set `aria-busy="true"`.

Icon buttons are 44px squares using the Secondary recipe with radius `--r-md`.

### 6.2 Inputs (text, email, password, select, number)
- Height 48px. Radius `--r-md`. Clay **well**: `background: var(--ink-900); box-shadow: var(--shadow-well)`.
- Text `cream-100` at 16px (16px prevents mobile zoom). Placeholder `cream-500`.
- Label above the field: Manrope 600, 14px, `cream-300`, sentence case. Hint or error below: 14px.
- Focus: add `outline: 3px solid var(--sun-500); outline-offset: 2px`, keep the inset shadow.
- Error: border `1.5px solid var(--blood-500)`, message in `blood-300` with an alert icon, linked with `aria-describedby`.
- The password field has a show/hide toggle, an icon button inside the right edge.
- Select: same well, with a chevron icon. Use the native `<select>` styled with `appearance: none`.

### 6.3 Cards
- **Monitor card** (level 2 clay card), padding 24px.
  Layout: orb on the left (56px), then name (Fredoka 18px, truncate), URL below (Manrope 14px, `cream-300`, truncate), then a bottom row with the status label pill, last response time ("142 ms", tabular), and "checked 12s ago" (`text-xs`, `cream-300`). Interval shows as a small flat chip ("every 5 min").
  Hover: lift 3px and use `--shadow-card-hover`. The whole card is a link, so it needs a focus ring. A paused card drops to 80% opacity on its text but keeps the orange orb.
- **Stat tile** (clay card, padding 20px): big number in Fredoka 36 to 48px, label under it in `text-sm` `cream-300`.

### 6.4 Status label pill
Radius pill, height 28px, padding 0 12px, Manrope 600 13px, with a 16px icon at the left.

| State | Fill | Text and icon |
|---|---|---|
| Up | `linear-gradient(145deg, var(--sun-300), var(--sun-500))` | `ink-950` |
| Down | `linear-gradient(145deg, var(--blood-400), var(--blood-600))` | `cream-100` |
| Pending | `ink-600` | `cream-300` |
| Paused | `linear-gradient(145deg, var(--ember-300), var(--ember-500))` | `ink-950` |

Pills use a small clay shadow: `4px 6px 12px rgba(0,0,0,.45), inset 2px 2px 4px rgba(255,255,255,.30), inset -3px -3px 6px rgba(0,0,0,.25)`.

### 6.5 Summary strip (dashboard)
Four stat tiles in a row (2 by 2 on mobile): **Up**, **Down**, **Paused**, **Pending**. Each shows a small orb (`sm` scale, 20px), the count in Fredoka 36px, and the label. Zero counts stay visible but at 60% opacity.

### 6.6 Table (recent checks)
Lives inside a clay panel. The table itself is a **flat data surface**: `ink-800` background, radius `--r-sm`, rows separated by 1px `ink-600`, no shadows on rows.
- Header row: `ink-700`, text `cream-300`, Manrope 600 13px, sentence case.
- Cells: 14px, vertical padding 12px, `tabular-nums` for time, code, and latency.
- A failed row gets a 3px `blood-400` bar on its left edge and the status text "Down". Do not tint the whole row.
- Latency over 1000 ms shows in `ember-300`.
- On mobile, the table scrolls horizontally inside its container, never the page.

### 6.7 Latency chart (recharts)
- Container: clay panel. Plot area: a **well** (`--ink-900`, `--shadow-well`), padding 16px.
- Line: `ember-500`, 3px, rounded joins, no dots by default. Area fill: vertical gradient from `rgba(255,122,26,0.28)` to `rgba(255,122,26,0)`.
- Failed checks: 7px circles in `blood-400` with a 2px `cream-100` ring, at the baseline of the chart.
- Grid: horizontal lines only, `ink-600`, dashed `4 6`. Axis text `cream-300`, 12px, tabular.
- Tooltip: a clay card (`--shadow-card`), radius `--r-md`, with time, latency, status, and code.
- Respect `prefers-reduced-motion` by passing `isAnimationActive={false}`.
- Empty state: centered orb (`pending`) and the text "No checks yet. The first result appears within a minute."

### 6.8 Modal and confirm dialog
- Overlay: `rgba(14,5,6,0.72)`. No blur.
- Dialog: clay panel, max width 520px, radius `--r-lg`, padding 32px. Title in Fredoka 22px.
- Opens with a 200ms scale from 0.96 to 1 and a fade. Closes on Escape and on overlay click (not for the delete confirm).
- Trap focus, return focus to the trigger on close, `role="dialog"` with `aria-labelledby`.
- Delete confirm: the title names the monitor ("Delete Payments API?"), body says "This also deletes its check history. This can't be undone.", buttons "Cancel" (secondary) and "Delete monitor" (danger).

### 6.9 Toasts
Clay card, radius `--r-md`, bottom-right on desktop and bottom-center on mobile, auto-dismiss after 4s (errors stay until dismissed). A 4px left accent strip: `sun-500` for success, `blood-400` for error. `role="status"` for success and `role="alert"` for errors.

### 6.10 Toggle (24h / 7d, Pause)
A pill-shaped well track (44 by 26) with a clay knob (22px circle using the card recipe). The selected segment of the 24h/7d switch is a raised clay pill sliding in a well. Both are keyboard operable with visible focus.

### 6.11 Skeletons
Placeholder shapes are wells (`ink-900` with `--shadow-well`) with a slow shimmer (`ink-800` to `ink-700`, 1.6s). Disable the shimmer under reduced motion.

### 6.12 Top bar
Clay panel, full width with a 16px margin from the page edges, radius `--r-lg`, height 72px. Left: logo (section 7). Right: the user email (`text-sm`, `cream-300`, hidden under 640px) and a Ghost "Log out" button. It is sticky with `top: 12px` and sits at `z-index: 20`.

---

## 7. Logo and Brand

**Logo mark:** a small clay orb (40px) with a dark pupil, like an eye that is always open, followed by the wordmark "Watcher" in Fredoka 600. The mark is the orb, so it ties to the signature component.

```svg
<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="g" cx="34%" cy="30%" r="75%">
      <stop offset="0" stop-color="#FF7A7F"/>
      <stop offset="0.5" stop-color="#D91E2B"/>
      <stop offset="1" stop-color="#5C0F18"/>
    </radialGradient>
  </defs>
  <circle cx="20" cy="20" r="18" fill="url(#g)"/>
  <circle cx="21" cy="21" r="7" fill="#0E0506"/>
  <circle cx="18.5" cy="18.5" r="2.2" fill="#FFF1EE" opacity="0.9"/>
</svg>
```

The tagline "Your APIs. Always in Sight." appears under the heading on the auth pages and in the page `<title>`/meta description. It does not appear in the top bar.

Favicon: the logo mark exported as SVG.

---

## 8. Layout and Screens

**General:** content is **left-aligned**. The page container is `max-width: 1120px`, centered, with 16px side padding on mobile, 24px on tablet, 32px on desktop. Vertical rhythm uses multiples of 8px, with 32px between major sections and 24px between cards.

**Breakpoints:** `sm` 640, `md` 768, `lg` 1024. Design mobile first, supporting 360px and up.

### 8.1 Login and Register

```text
┌────────────────────────────────────────────┐
│                                            │
│      [orb] Watcher                         │
│                                            │
│   ┌──────────────────────────────────┐     │
│   │  Log in                          │     │  clay panel, max-w 440px
│   │  Your APIs. Always in Sight.     │     │  centered vertically and horizontally
│   │                                  │     │
│   │  Email                           │     │
│   │  [ well input               ]    │     │
│   │  Password                        │     │
│   │  [ well input            👁 ]    │     │
│   │                                  │     │
│   │  [   Log in  (primary, full)  ]  │     │
│   │                                  │     │
│   │  New here? Create an account     │     │
│   └──────────────────────────────────┘     │
└────────────────────────────────────────────┘
```
Text inside the panel is left-aligned. The only decorative flourish is a large, partially cropped orb (180px, `down` color at 20% opacity, no animation) behind the top-right of the panel. Keep it static.

### 8.2 Dashboard

```text
┌─────────────────────────────────────────────────────────┐
│ [orb] Watcher                      me@test.com  Log out │  top bar (clay panel)
└─────────────────────────────────────────────────────────┘

 Monitors                                    [ + Add monitor ]   page title + primary button

 ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
 │ ● 4    │ │ ● 1    │ │ ● 1    │ │ ● 0    │   summary strip (stat tiles)
 │ Up     │ │ Down   │ │ Paused │ │ Pending│
 └────────┘ └────────┘ └────────┘ └────────┘

 ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
 │ (orb)  Payments API   │ │ (orb)  Search         │ │ (orb)  Auth service   │
 │        api.pay.io/h…  │ │        search.io/…    │ │        auth.io/…      │
 │ [Up]  142 ms · 12s ago│ │ [Down] — · 8s ago     │ │ [Paused] 98 ms · 4h   │
 └───────────────────────┘ └───────────────────────┘ └───────────────────────┘
```
Grid: 1 column under 640px, 2 columns from 640px, 3 columns from 1024px. Cards sort with down monitors first, then up, then pending, then paused, and alphabetically within each group.

**Empty state:** a centered clay panel with a `pending` orb (`xl`), title "No monitors yet", text "Add the first API you want to keep an eye on.", and a primary "Add monitor" button.

### 8.3 Monitor detail

```text
 ← Monitors

 ┌──────────────────────────────────────────────────────────────┐
 │ (orb xl)  Payments API                                       │
 │           https://api.pay.io/health        [Up]              │
 │           [Check now] [Pause] [Edit] [Delete]                │
 └──────────────────────────────────────────────────────────────┘

 Last 24 hours  ( 24h | 7d )
 ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
 │ 99.2%   │ │ 151 ms  │ │ 288     │ │ 2       │   stat tiles
 │ Uptime  │ │ Average │ │ Checks  │ │ Failed  │
 └─────────┘ └─────────┘ └─────────┘ └─────────┘

 ┌──────────────────────────────────────────────────────────────┐
 │ Response time                                                │
 │ ┌ well ────────────────────────────────────────────────────┐ │
 │ │  line chart                                              │ │
 │ └──────────────────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────────────┘

 ┌──────────────────────────────────────────────────────────────┐
 │ Recent checks                                                │
 │  Time        Status   Code   Response   Error                │
 │  ...         flat table rows                                 │
 └──────────────────────────────────────────────────────────────┘
```
On mobile, the action buttons wrap below the title, the stat tiles go 2 by 2, and the table scrolls horizontally in its container.

### 8.4 Not found
Centered `down`-colored orb (`xl`, static) with title "Page not found", body "That page doesn't exist or you don't have access to it.", and a primary button "Back to monitors".

---

## 9. Motion

Motion either answers a person's action or marks a real status change. There are no decorative entrance animations.

| Where | Effect | Duration |
|---|---|---|
| Button, card hover | Lift 2 to 3px, shadow grows | 140ms |
| Button press | Move down 1px, switch to the pressed shadow | 100ms |
| Modal open | Scale 0.96 to 1, fade | 200ms |
| Toast appear | Slide up 8px, fade | 200ms |
| Down orb | Glow pulse (the only looping animation) | 1.8s |
| Orb or badge changes state after a refetch | Cross-fade color | 300ms |
| Chart | Draw on first load only | 500ms |

Always wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` and disable it there. The down glow becomes a static, stronger glow.

---

## 10. Copy and Voice

Plain, direct, and sentence case. Say what happens. Errors state what went wrong and how to fix it, and never apologize.

| Context | Copy |
|---|---|
| Primary actions | "Add monitor", "Save changes", "Log in", "Create account", "Check now", "Pause monitor", "Resume monitor", "Delete monitor" |
| Action to toast (same verb) | "Add monitor" gives "Monitor added". "Delete monitor" gives "Monitor deleted". "Save changes" gives "Changes saved". |
| Empty monitors | "No monitors yet" / "Add the first API you want to keep an eye on." |
| Empty results | "No checks yet. The first result appears within a minute." |
| Pending explanation | "Waiting for the first check." |
| URL blocked (`URL_NOT_ALLOWED`) | "Watcher can only check public web addresses. Use an https:// URL that's reachable from the internet." |
| Monitor limit | "You've reached the limit of 10 monitors. Delete one to add another." |
| Wrong credentials | "Email or password is incorrect." |
| Email taken | "An account with this email already exists. Try logging in." |
| Weak password | "Use 10 to 72 characters." |
| Rate limited | "Too many attempts. Wait a few minutes and try again." |
| Session expired | "Your session ended. Log in to continue." |
| Network error | "Couldn't reach Watcher. Check your connection and try again." |
| Check error strings | Show the backend `error` value as is, for example "Expected 200, got 503". |

Time formats: relative under 24 hours ("12s ago", "5 min ago", "3 h ago"), otherwise a date and time. Latency as "142 ms", or "1.2 s" at 1000 ms and above. Uptime as "99.2%" with one decimal in the UI.

---

## 11. Accessibility Requirements

1. Every interactive element has a visible focus state (3px `sun-500` outline, 2 to 3px offset). Do not remove outlines.
2. Contrast follows section 2.4. Do not use `cream-500` for required information.
3. Status is never conveyed by color alone: icon plus text label on every pill and orb.
4. Touch targets are at least 44 by 44px.
5. Forms use real `<label>` elements, `aria-describedby` for errors, and `autocomplete` attributes (`email`, `current-password`, `new-password`).
6. Modals trap focus, close on Escape, and restore focus.
7. Live updates: toasts use `role="status"` or `role="alert"`. Polling refreshes must not move focus or reorder cards while a card is focused.
8. Respect `prefers-reduced-motion` (section 9).
9. The chart has a text alternative: a visually hidden summary ("Response time over the last 24 hours, average 151 ms, 2 failed checks") and the table below it holds the same data.
10. Test at 200% zoom and at 360px width without horizontal page scroll.

---

## 12. Tailwind Configuration

`frontend/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:   { 950: '#0E0506', 900: '#160809', 800: '#1F0D0F', 700: '#2B1316', 600: '#3A1D21', 500: '#4F2A2F' },
        blood: { 950: '#1F0709', 900: '#3A0C11', 800: '#5C0F18', 700: '#8A1220', 600: '#B3131F',
                 500: '#D91E2B', 400: '#F0434B', 300: '#FF7A7F', 200: '#FFB3B5' },
        ember: { 700: '#C75A0B', 500: '#FF7A1A', 300: '#FFA85C' },
        sun:   { 700: '#C99410', 500: '#FFC83D', 300: '#FFE08A' },
        cream: { 100: '#FFF1EE', 300: '#C9A9AA', 500: '#8F7274' },
      },
      fontFamily: {
        display: ['Fredoka', 'ui-rounded', '"Trebuchet MS"', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: { 'clay-sm': '14px', 'clay-md': '22px', 'clay-lg': '32px' },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        well: 'var(--shadow-well)',
        pressed: 'var(--shadow-pressed)',
        primary: 'var(--shadow-primary)',
      },
      transitionTimingFunction: { clay: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    },
  },
  plugins: [],
};
```

File layout:
```
frontend/src/
├── styles/tokens.css      # all :root variables from section 4.4
├── index.css              # @tailwind directives, body background (4.1), @layer components (4.5), orb styles (5)
└── components/ui/         # Button, Input, Select, Card, Panel, StatusPill, Orb, Modal, Toast, Toggle, Skeleton
```
`components/ui/` holds the reusable primitives. `StatusBadge` and `MonitorCard` from the PRD are built from `Orb`, `StatusPill`, and `Card`.

---

## 13. Do and Don't

**Do**
- Keep the light source top-left on every clay element.
- Let the orbs be the loudest thing on the screen.
- Use wells for anything the user types into or reads data from.
- Keep red-and-black dominant: about 70% black and maroon surfaces, 20% crimson and red, 10% orange and yellow.
- Use Fredoka only for titles and numbers, Manrope for everything else.

**Don't**
- Don't use pure black (`#000`) or pure white (`#fff`) for surfaces or text. Use the `ink` and `cream` tokens.
- Don't add blue, green, or purple, including in charts, toasts, and links.
- Don't add `backdrop-filter` blur or glassmorphism. It conflicts with the clay look.
- Don't put drop shadows on table rows or on text.
- Don't stack more than two clay levels.
- Don't use all-caps labels, small mono labels, or "→" arrows on links and buttons.
- Don't animate anything on page load except the chart's first draw.
- Don't use radii under 14px on clay elements.

---

## 14. Review Checklist (before finishing Step 13)

- [ ] `tokens.css` contains every variable in section 4.4 and Tailwind uses them.
- [ ] Fonts load (check the Network tab) and fall back gracefully.
- [ ] Orbs show correctly for up, down, paused, and pending. Only down animates, and it stops under reduced motion.
- [ ] Every status has an icon and a text label.
- [ ] Buttons show hover, pressed, focus, disabled, and loading states.
- [ ] Inputs show a well, a focus ring, and an error state.
- [ ] Tables are flat rows inside a panel. The chart sits in a well.
- [ ] No third nested clay level anywhere.
- [ ] Keyboard-only walkthrough works for login, add monitor, open detail, delete with confirm.
- [ ] 360px width: no horizontal page scroll.
- [ ] No colors outside the palette (search the code for hex values that are not in `tokens.css`).
- [ ] Copy matches section 10 (sentence case, same verb in button and toast).

## 15. V3 additions

- **Pills:** notification and incident states reuse existing pill variants with text labels: sent uses the Up style, failed uses the Down style, pending and sending use the Paused (orange) style, and suppressed uses the Pending (grey) style. Incident `Open` uses the Down style and `Resolved` uses the Up style.
- **Uptime bar:** each segment is 6px wide and 28px tall with a 3px radius and 2px gap. Use `sun-500` when `failed = 0`, `blood-400` when `failed > 0`, and `ink-600` when there is no data. A flat container with the clay well treatment holds the bar; focus rings follow the global rule.
- **Navigation links:** 44px tall hit area, `cream-300`, hover `cream-100`, and current page `cream-100` with a 3px `sun-500` underline with a rounded end.
- **Copy-to-clipboard button:** secondary icon button; its label changes to “Copied” for two seconds and is announced with `aria-live="polite"`.
