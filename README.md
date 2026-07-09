# Shelf — Personal Book Library

A premium, offline-first personal library. Catalogue what you own, track how far
through each book you are, lend books to friends, and keep a stamped record of
every loan and return.

Built with **HTML5, CSS3 and vanilla JavaScript**. No frameworks, no build step,
no dependencies, no network calls (fonts aside). Everything lives in the browser.

---

## Run it

```bash
git clone <your-repo> shelf && cd shelf
open index.html            # or: python3 -m http.server 8000
```

That's the whole setup. Opening `index.html` directly works — there is nothing to
compile and no server required.

---

## Files

```
shelf/
├── index.html   # semantic structure, SVG icon sprite, JSON-LD, dialogs, card template
├── style.css    # design tokens, both themes, layout, components, motion
├── script.js    # store → state → derive → render, one-way data flow
└── README.md
```

---

## Features

**Internship requirements**

| Requirement | Where |
| --- | --- |
| Book search | Debounced live search across title, author, category and ISBN, with matched text highlighted in results. Focus it with `/`. |
| Categories | Auto-derived from your books. Each gets a stable colour from a hash of its name, used on chips, spines and charts. Filter by clicking a chip. |
| Borrowing history | Every loan and return is stamped into the ledger, with due dates and late returns flagged. |

**Everything else**

- **Dashboard** — Total books · Borrowed · On the shelf · Categories, each with a live secondary metric.
- **Add / Edit / Delete** — validated form, inline errors, and a 7-second **Undo** on every delete.
- **Book details modal** — cover, facts, description, loan card, borrowing timeline, and a live progress slider.
- **Borrow / Return** — record the borrower and a due date (defaults to +14 days). Overdue books are surfaced everywhere: card ribbon, status pill, dashboard, statistics.
- **Reading progress** — 0–100% per book, editable from the details modal, aggregated into pages read.
- **Favorites** — heart any cover; favorites get their own view.
- **Recently added** — a scroll rail of the last five arrivals.
- **Filter · Sort** — by category, availability and reading state; eight sort orders.
- **Grid / list layouts** — persisted between sessions.
- **Statistics** — books per category, a reading-progress doughnut, most-shelved authors, and lending totals.
- **Import / export** — your library as portable JSON. Import merges and de-duplicates IDs.
- **Local storage** — versioned schema, written on every mutation, degrades gracefully if the quota is full.
- **Dark & light themes** — follows your system by default, toggle with `T`.
- **Responsive** — a single grid that collapses from a 6-up shelf to a 2-up phone layout; the sidebar becomes an overlay drawer under 860px.

---

## Design

The brief asked for glassmorphism, dark mode and premium typography — those are
givens, so the originality is spent elsewhere.

**The spine is the signature.** Every book generates its own jacket: a deterministic
hue derived from its category, a darker spine down the left edge, a debossed
publisher's seal, and a hover that rotates the cover on its Y axis as if you were
pulling it off a shelf. Two books in the same category share a family of colour but
never the exact same one — the title contributes a small hue drift.

**History is a date-due slip.** The borrowing ledger isn't a table; it's the card
pasted inside the back cover of a library book, complete with punched-hole ring and
a rotated rubber stamp. Late returns stamp in red.

**Type.**
- *Fraunces* (variable, `SOFT` and `WONK` axes engaged) for display, jacket titles and statistics — a serif with enough character to earn the space.
- *Manrope* for the interface.
- *JetBrains Mono* for anything stamped, dated or counted: eyebrows, ISBNs, key caps, tabular figures.

**Palette.** Ink violet `#8B8AFF`, brass `#E0B27A`, jade `#4FB6A5`, rose `#E0708D`,
on a near-black `#0B0D14` washed with two soft radial gradients. Brass means *lent*,
jade means *shelved*, red means *overdue* — colour carries state, not decoration.

---

## Architecture

Data flows one way. Nothing renders from anything but `state`.

```
   action  →  mutate state  →  persist()  →  render()
                   ↑                            │
                   └──────── user event ────────┘
```

- **Store** — versioned `localStorage` wrapper (`shelf.v1`). Reads defensively; a corrupt payload falls back to the seed shelf rather than throwing.
- **State** — the single source of truth: `books`, `history`, and UI preferences.
- **Derive** — pure functions. `visibleBooks()` composes filter → search → sort. `metrics()` computes every dashboard and statistics number. Nothing is stored twice: a book's *reading state* is derived from `progress`, and *overdue* is derived from `dueAt`.
- **Render** — small painters (`renderGrid`, `renderLedger`, `renderStatsView`…) that only read state.
- **Events** — delegated. One listener on the grid handles open, favorite, lend, edit and delete for every card, so adding books never adds listeners.

Cards are cloned from a `<template>` rather than assembled from strings, and every
value that reaches `innerHTML` passes through `esc()`.

---

## Accessibility

Targets WCAG 2.1 AA.

- Semantic landmarks (`header`, `main`, `nav`), one `h1` per view, correct heading order.
- Native `<dialog>` for every modal: real focus trapping, `Esc` to dismiss, focus returned to the trigger.
- Destructive dialogs open with focus on the *safe* button, never on **Delete**.
- Toggles report `aria-pressed`; the active nav item reports `aria-current="page"`; the star rating implements the ARIA radiogroup pattern with roving `tabindex` and arrow-key support.
- Result counts and toasts announce through `aria-live` regions.
- Visible `:focus-visible` rings everywhere; a skip link to the shelf.
- `prefers-reduced-motion` disables the cover tilt, the staggered card entrance and all transitions.
- `prefers-contrast: more` drops the backdrop blur and hardens borders.
- Icons are `aria-hidden`; every icon-only button carries a contextual label ("Lend *Piranesi*", not "Lend").

## Keyboard

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Esc` | Close dialog, or clear search |
| `N` | Add a book |
| `T` | Toggle theme |
| `G` then `L` `F` `B` `H` `S` | Library · Favorites · On loan · History · Statistics |
| `?` | Shortcuts |

---

## Performance

- Zero dependencies; ~30 KB of uncompressed CSS + JS.
- Icons are one inline SVG sprite — no icon font, no HTTP requests, no layout shift.
- Search is debounced (120 ms); progress-slider writes are debounced (220 ms).
- Grid repaints use `replaceChildren()` with a single fragment.
- Ambient background gradients are `position: fixed` on a pseudo-element, so scrolling never repaints them.
- Animations are limited to `transform`, `opacity` and `translate` — compositor-only.
- Fonts load with `display=swap` behind `preconnect`.

## SEO

Descriptive `<title>` and meta description, canonical URL, Open Graph and Twitter
cards, `WebApplication` JSON-LD, an inline SVG favicon, `lang="en"`, and a
`theme-color` for each colour scheme.

## Browser support

Chrome/Edge 111+, Firefox 113+, Safari 16.4+ — the floor set by `color-mix()` and
`<dialog>::backdrop`. No polyfills are shipped.

## Data & privacy

Nothing leaves your device. Your library is stored in `localStorage` under
`shelf.v1`, and **Export library** hands you the whole thing as JSON whenever you
want it back.

---

## Licence

MIT.
