# Roadmap

Candidate features, ordered roughly by impact. None are committed —
each needs a design pass before implementation.

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

## 14. Controller-class-method opt-out for keep-open-on-redirect

Today's close-on-redirect default has two opt-outs: per-overlay (link
helper) and per-form (form data attribute). A third level —
controller-class-method — would let an app declare keep-open behavior
at the action level:

```ruby
class WizardsController < ApplicationController
  keep_overlay_open_on_redirect :step1, :step2
end
```

Useful when the same action is opened from multiple links and the
keep-open behavior is really a property of the action, not of the
trigger.

The natural mechanism — set a response header on the `redirect_to`
response — is invisible to `fetch` after it follows the redirect, so
the implementation needs one of:

1. **Flash-based signaling.** The redirecting action sets
   `flash[:_turbo_overlay_keep_open] = true`; the redirect target's
   `after_action` reads it back and sets the
   `X-Turbo-Overlay-Keep-Open` response header; client reads it from
   the final response. Server-only, but uses flash for non-message
   state and depends on the redirect target including the concern.
2. **`redirect_to_in_overlay` helper.** A parallel `redirect_to` that
   emits a turbo-stream visit action targeting the overlay's frame
   instead of issuing an HTTP redirect. No session side-effects, but
   introduces a parallel redirect API the developer has to remember.

Deferred until the per-overlay opt-out shows wear in practice. The
wizard-style use case is fully covered by per-overlay opt-out today
when the wizard is opened from a single link.

## 15. CSS anchor positioning for popovers

Popover placement currently runs in JS: a `scroll`/`resize` reflow
handler reads `anchor.getBoundingClientRect()` and writes
`transform: translate(x, y)` on every frame. Modern browsers ship a
declarative alternative — `anchor-name` / `position-anchor` /
`position-area` / `position-try-fallbacks` — that hands all of this
to the compositor and eliminates the residual one-frame lag on
momentum scrolling.

Browser support as of 2026: Chrome shipped (125+), Safari partial
(`anchor()` function, `position-try-fallbacks` uneven), Firefox
behind a flag. Defer until Firefox ships and Safari catches up on
fallbacks; the end state is *deleting* the JS positioner entirely,
not running it in parallel.

The auto-close-on-anchor-exit logic still needs JS
(IntersectionObserver) regardless, so the module won't be empty
either way.

## 16. Hover-prefetch overlay-opening links

Turbo's `LinkPrefetchObserver` excludes `data-turbo-stream` links
from prefetch (`nonSafeLink` predicate, treated as side-effecty).
Overlay-opening links are stream links, so a hover on
`modal_link_to` never warms the cache and the click pays full
round-trip latency.

Two paths forward, both blocked on upstream:

1. **Petition Turbo to relax the exclusion** for GET stream links
   via a `data-turbo-prefetch="true"` opt-in. The prefetch fetch
   would need to carry the `X-Turbo-Overlay-*` headers so the cached
   response is the right shape — the gem's `turbo:before-prefetch`
   listener could inject them. A small PR to turbo-rails.
2. **Roll our own prefetch.** Hover handler fires a fetch with
   overlay headers, caches by URL, click consumes it. Rejected
   per `feedback_no_parallel_fetch` — we'd be duplicating Turbo's
   prefetch machinery instead of integrating with it.

Deferred unless Turbo accepts the upstream change.

## 17. Two stream-submitting forms in one dialog

Capybara's `send_keys :escape` fails when a dialog hosts two
`<form data-turbo-stream>` elements (see the `Bearing`-only gating
in `test/dummy/app/views/widgets/show.html.erb`). Whether this is a
real user-visible bug or only a `send_keys` artifact is unclear —
the failing path synthesizes the ESC keypress, which may interact
differently from a real keyboard event. Worth investigating before
documenting any limitation.
