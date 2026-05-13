# Roadmap

Candidate features, ordered roughly by impact. None are committed —
each needs a design pass before implementation.

## 1. URL advance / shareable overlay URLs

Update the URL bar when an overlay opens and let browser-back close it.

- `advance: true` on a link → push the link's target URL
- `advance: "/foo/bar"` → push a custom URL
- Default off (configurable per overlay type)
- Browser back closes the top overlay and replays the previous history
  entry, *not* the page beneath

Open questions for stacking:
- Does each stacked layer push a history entry, or only the bottom?
  Leaning top-overlay-only — multiple pushes per user action turn the
  back button into a stutter-step.
- How does this interact with `turbo_stream.overlay(:close,
  scope: :all)`? One `history.go(-n)`, or `replaceState` to the base
  URL?
- Popovers and hints almost certainly opt out — they're ephemeral.

## 2. Click-outside allowlist for body-appended widgets

Whitelist of CSS selectors whose clicks shouldn't dismiss the overlay.
Solves flatpickr, Select2, Tippy, Tom Select, and every other widget
that portals its dropdown to `<body>`.

- Global config: `config.allowed_click_outside_selector = [".flatpickr-calendar", ...]`
- Per-overlay override via data attribute on the dialog
- Reads selectors at dismiss time so apps can extend at runtime

UTMR's defaults list is a useful starting point for the docs.

## 3. Mousedown-origin dismiss check

Even without #2, fix the "drag a text selection out of the dialog and
release on the backdrop" bug. Track which element `mousedown` landed
on; if it was inside the dialog content, suppress the subsequent
backdrop-click dismissal.

Small, orthogonal to #2, and fixes a class of false dismissals that
the allowlist can't catch.

## 4. Smooth same-page redirect / morph-behind

On a successful submit that redirects to the *same* page the overlay
was opened from, morph the page behind the overlay before animating
the close. Redirects to a *different* page animate close → navigate.

Avoids the flash-of-stale-content that bare Turbo redirects can
produce after closing.

Building block already exists: idiomorph runs on in-overlay form
re-renders. Extending it to "morph the host page on close" is the
next step.

## 5. Free-form `size:` for modals, drawers, and popover min-width

UTMR's drawer takes `:xs / :sm / :md / :lg / :xl / :"2xl" / :full` or
any CSS length (`"500px"`, `"50vw"`, `"30rem"`). Validation is one
regex; the value is set as an inline CSS custom property.

Extend the same idea across overlay types:

- **Drawer `size:`** — width when positioned left/right, height when
  top/bottom. The existing presets-or-CSS-length pattern, lifted from
  UTMR.
- **Modal `size:`** — controls max-width. Same preset table and the
  same regex.
- **Popover `min_width:`** — popovers size to content by default, but
  some triggers want a guaranteed floor (e.g. an "Edit" popover that
  shouldn't be narrower than the form it wraps). Same preset table,
  set as `min-inline-size` instead of `inline-size`.

One validator, one preset table, one CSS-var convention across all
three. Skip `max_width:` / `max_height:` knobs until a real need
surfaces.

## 6. Demo app + recorded walkthrough

A `demo-app/` in the repo that boots with `bin/dev` and exercises
every overlay type: stacked modals, drawer-from-modal, popover with
auto-flip, hover hints, themed confirms, form validation re-render.
Pair it with a short screencast.

For a stacking overlay system with no external consumers yet, this is
likely higher leverage than another feature — readers can grasp
"modal opens a popover that stacks over a drawer" in 30 seconds of
video, not from prose.

## 7. I18n for default strings

Close-button `aria-label`, loading-state text, default confirm OK /
Cancel labels. Currently English literals in the shipped chrome
partials.

- Resolve via `I18n.t("turbo_overlay.close")` etc. with English
  fallbacks
- Ship `config/locales/en.yml` with all keys
- Eject path stays unchanged — apps that want custom copy override
  the partials

## 8. System test helpers

Capybara matchers as a require-able module:

- `assert_overlay_open(:modal)` / `assert_overlay_open(:drawer, id: "edit_user_42")`
- `within_overlay(:modal) { ... }`
- `close_overlay` (ESC) / `dismiss_overlay` (backdrop click)
- `assert_no_overlay`
- `assert_overlay_stack_depth(2)`

Test harness is already Cuprite-based, so the matchers can lean on
real DOM state rather than guessing. Writing them will surface
any DOM-stability issues worth fixing in the gem itself.

## 11. Destructive confirm variant

Themed confirm prompt with a red primary button for destructive
actions. Surface area:

- `data-turbo-confirm-style="danger"` (extends the existing
  per-link style attribute)
- Chrome partial reads the style and swaps button classes

Trivial in the chrome partial; common enough that every app rolls its
own.

## 12. Print-aware CSS

Default print stylesheet currently captures the overlay backdrop and
the dialog on top of the page content — wrong by default. Decide
between two reasonable behaviors and pick one:

- `@media print { dialog[open] { display: none } }` — print the page
  underneath, ignore the overlay
- Print the overlay content as a normal block, drop the backdrop

Either is better than the status quo. Ship as part of the gem CSS so
apps don't have to think about it.

## 13. Auto-focus opt-out

Native `<dialog>` autofocuses the first focusable element on open.
Apps usually want this; popovers and hints often don't (the trigger
should keep focus). The `turbo-overlay:shown` event lets apps
override, but a declarative opt-out is one line of JS:

- `data-turbo-overlay-autofocus-value="false"` on the dialog skips
  the initial focus call
- Link helper option: `autofocus: false`
- Sensible defaults per overlay type (popovers/hints default off?
  needs a design pass)
