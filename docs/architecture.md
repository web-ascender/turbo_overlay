# Architecture

How the gem fits together. You don't need any of this to use it —
this doc is for contributors, people debugging unusual interactions,
and anyone considering ejecting parts of the gem.

## Stack and frames

A single `<div id="turbo_overlay_stack">` lives on the host page,
emitted by `overlay_stack_tag`. Every overlay is appended to that
stack as its own `<turbo-frame id="turbo_overlay_<type>_<id>">`
wrapping a `<dialog>`. Forms inside the overlay re-render in place
via standard Turbo frame scoping.

Stacking follows the browser's top-layer "last shown wins" order.
Modals and drawers enter via `dialog.showModal()`; popovers and
hints enter via the native Popover API (`element.showPopover()` on
a `popover="manual"` element). Whichever overlay was shown most
recently renders on top — so a popover opened from inside a modal
sits above that modal, and a modal opened from inside a popover
sits above the popover. Popovers still replace each other on the
same layer via the stack controller's single-popover rule.

### Popover inside a modal: `showModal()` instead of `showPopover()`

Top-layer ordering puts the popover *visually* above the modal, but
HTML's modal-dialog inertness algorithm blocks every non-descendant
of the topmost modal from receiving input — including top-layer
popovers added afterwards. The popover would render above the modal
but clicks would pass through to the modal underneath.

To work around this, the overlay controller checks for any open
`dialog:modal` at connect time and uses `showModal()` for the
popover when one is present, so the popover becomes the topmost
modal itself. CSS makes the resulting `::backdrop` transparent so
the popover still looks non-modal. Non-modal drawers (`backdrop:
false`) are *not* auto-promoted — `dialog:modal` UA styles override
the gem's drawer-position CSS and re-center the drawer, so the
fallback is documented as a limitation instead.

### Positioning normalization

The popover and hint positioners override `right: auto; bottom: auto;
margin: 0` *before* measuring the dialog rect. UA `[popover]` styles
include `inset: 0; margin: auto`, and `dialog:modal` adds
`width: auto`. Without the override, measurement reflects a
UA-stretched or centered layout, and the auto-flip math computes
against the wrong width; the dialog also visually drifts toward the
center via the auto margins after we set `top`/`left`.

## Layout proc

Including `TurboOverlay::Controller` installs:

```ruby
layout -> { turbo_overlay_layout }
```

`turbo_overlay_layout` returns `"turbo_overlay/modal"` (or `drawer`,
`popover`, `hint`) on overlay requests, `"turbo_rails/frame"` on
plain turbo-frame requests, and `nil` otherwise. The `nil` falls
through to whatever layout the controller declared previously.

For custom layout methods, app code calls `turbo_overlay_layout`
explicitly to compose with its own logic.

## Request lifecycle: opening an overlay

When `modal_link_to "Edit", edit_user_path(@user)` is clicked:

1. A JS fetch hook adds `X-Turbo-Overlay: modal` (and optional
   `X-Turbo-Overlay-Id`, `-Position`, `-Align`, `-Offset`,
   `-Backdrop`, `-Close` headers) to Turbo's request.
2. The controller concern's `before_action` reads `X-Turbo-Overlay`,
   sets `request.variant = :modal`, and forces html template
   resolution.
3. Rails picks `edit.html+modal.erb` if it exists, else `edit.html.erb`.
4. The layout proc returns `"turbo_overlay/modal"`. The modal layout
   wraps the view in `<turbo-stream action="append" target="turbo_overlay_stack">`
   whose template contains a
   `<turbo-frame id="turbo_overlay_modal_<id>">` around the
   `<dialog>`.
5. An `after_action` sets the response Content-Type to
   `text/vnd.turbo-stream.html; charset=utf-8` so Turbo processes
   the stream tag.
6. Turbo appends the frame into the stack.
7. The per-dialog `turbo-overlay` Stimulus controller registers
   with the stack controller and opens the dialog.

## Request lifecycle: form re-render

When a form inside an overlay submits:

1. Turbo scopes the request to the enclosing turbo-frame
   (`turbo_overlay_modal_<id>`) and sends that frame id in the
   `Turbo-Frame` header.
2. On success, the controller responds with a turbo-stream
   containing `turbo_stream.overlay(:close)` and any host-page
   updates.
3. On validation failure
   (`render :new, status: :unprocessable_entity`), the layout
   detects the frame request and wraps the response in
   `<turbo-frame id="turbo_overlay_modal_<id>">`. Turbo replaces
   the frame contents in place. The per-dialog Stimulus controller
   re-connects on the new `<dialog>` and re-opens it in the same
   mode (`showModal()` / `show()`) so the overlay stays visible.

## Request headers

| Header                       | Purpose                                                 |
|------------------------------|---------------------------------------------------------|
| `X-Turbo-Overlay`            | `modal` / `drawer` / `popover` / `hint`                 |
| `X-Turbo-Overlay-Id`         | Optional caller-supplied stable id                      |
| `X-Turbo-Overlay-Position`   | Drawer side or popover side                             |
| `X-Turbo-Overlay-Align`      | Popover cross-axis alignment                            |
| `X-Turbo-Overlay-Offset`     | Popover pixel offset                                    |
| `X-Turbo-Overlay-Backdrop`   | `false` to open non-modally                             |
| `X-Turbo-Overlay-Close`      | `false` to suppress the chrome's close button           |
| `X-Sec-Purpose: prefetch`    | Turbo's hover prefetch — the W3C `Sec-*` prefix is forbidden for JS-initiated fetch, so Turbo prepends `X-`. |

## Chrome partials and body-only partials

Chrome partials (`_modal`, `_drawer`, `_popover`, `_hint`) are
rendered as layouts via `render(partial:, layout:)`. They `<%= yield %>`
the body and read `content_for(:overlay_title)` /
`content_for(:overlay_footer)`.

Body-only partials (`_confirm`, `_loading`) are wrapped by the
matching chrome at template-emission time so the app doesn't have
to repeat chrome boilerplate. `overlay_stack_tag` does:

```ruby
render(partial: "turbo_overlay/confirm",
       layout:  "turbo_overlay/modal",
       variants: [:modal],
       locals:  { close: false })
```

When the chrome's `loading:` local is `true`, it drops the Stimulus
controller wiring, close button, and title/footer slots, and
switches `aria-labelledby` for
`role="status" aria-live="polite" aria-label="Loading"`.

## Loading placeholders

`overlay_stack_tag` emits a `<template>` per chrome type:

```html
<template id="turbo_overlay_loading_modal_template">…</template>
<template id="turbo_overlay_loading_drawer_template">…</template>
<template id="turbo_overlay_loading_popover_template">…</template>
<template id="turbo_overlay_loading_hint_template">…</template>
```

Click flow:

1. The stack controller mints an `ov-<rand>` overlay id (sticky on
   the link element so re-clicks reuse it) and clones the matching
   template into a `<turbo-frame>` with the eventual server frame id.
2. Turbo's request gets `X-Turbo-Overlay-Id` so the server renders
   the real frame with the same id.
3. When the response arrives, `turbo:before-stream-render` morphs
   the new dialog's attributes and children onto the placeholder
   dialog in place — same DOM node, `[open]` never drops, only one
   open animation plays.
4. ESC or backdrop click on a placeholder calls `aborter.abort()`
   on an `AbortController` injected into Turbo's `fetchOptions.signal`.

## Hover hints

Two paths, same `+hint` variant template:

**Plain links** ride Turbo's hover prefetch. The gem listens for
`turbo:before-fetch-response`, extracts
`<template id="turbo-overlay-hint">` from the response, and caches
the fragment by URL.

**Overlay links** carry `data-turbo-stream="true"`, which Turbo's
prefetch refuses. With `hint_url:` set, the gem fetches that URL
with the `:hint` request variant on hover via plain `fetch()` and
parses the response with `DOMParser`. The `turbo_overlay/hint`
layout wraps the variant template in `<template id="turbo-overlay-hint">`
so the extractor logic is identical.

`overlay_stack_tag` only renders the `+hint` variant on hintable
requests (`overlay_hintable_request?` — `hint_request?` or
`overlay_prefetch_request?`). On a regular page render the variant
isn't loaded — no DB cost, no partial render.

Detection uses `lookup_context.find_all(..., variants: [:hint])`
plus an identifier-level `+hint.` check on disk, because Rails'
variant resolution treats no-variant as an acceptable match for any
variant query — a plain `exists?` would render the entire page as
the hint body.

### Caching specifics

- **Negative cache.** If a fetched URL has no hint template (or the
  fetch errors), the URL is cached as `NO_HINT`. Subsequent hovers
  short-circuit at the show-delay tick — no placeholder, no refetch.
  The negative cache clears on `turbo:visit`.
- **Redirects.** If `users/42` redirects to `profiles/42`, the
  fragment is cached under both URLs so hovering either link
  resolves to the same hint.
- **Prefetch opt-outs.** When `<meta name="turbo-prefetch" content="false">`
  is set or an ancestor has `data-turbo-prefetch="false"`, the hint
  module falls back to its own `fetch()` so `+hint` templates keep
  working.
- **Safety cap.** If neither `hint-ready` nor `fetch-request-error`
  arrives within 10s, the pending placeholder dismisses and the URL
  is cached as `NO_HINT`.

## Themed confirm

`register(application, { confirm: true })` registers a
`Turbo.config.forms.confirm` hook. The hook clones a `<template>`
emitted by `overlay_stack_tag`:

```html
<template id="turbo_overlay_confirm_modal_template">…</template>
<template id="turbo_overlay_confirm_popover_template">…</template>
```

For popover style, the hook needs an anchor — the element that
triggered the submission. Form-button submissions get it via Turbo's
submitter; link-with-method submissions don't (Turbo synthesizes a
hidden form with no submitter), so the gem captures the originating
`[data-turbo-confirm]` element on click (capture phase,
freshness-bounded) and uses it as the popover anchor.

If no anchor is resolvable, the gem falls back to modal style
silently rather than rendering a popover at the top-left corner.

## Back/forward cache

When the user navigates away from a page with an open overlay (or
an in-flight loading placeholder), Turbo's page-cache restore would
otherwise bring the `<dialog open>` back into the DOM — but
`showModal()`'s top-layer membership is per-document and is lost
across navigations, so the restored dialog would render inline with
no backdrop, no focus trap, and an ESC key that no longer fires
native `cancel`.

The stack controller listens for `turbo:before-cache` and tears
down every `turbo-frame.turbo-overlay-frame` (live and loading),
closes any open dialogs, aborts in-flight overlay fetches, and
clears the popover-trigger registry. The cached snapshot has no
overlay state to restore.

## JavaScript modules

- **`setup.js`** — self-bootstraps on import. Registers the
  `<turbo-stream action="overlay">` action, the fetch hook that
  adds `X-Turbo-Overlay-*` headers, the click hook that drops
  loading placeholders, and (when opted in) the themed confirm
  hook. Owns three module-scope registries: popover trigger,
  dismissed loading ids, in-flight fetch aborters.
- **`stack_controller.js`** — Stimulus controller on the stack
  container (`turbo-overlay-stack`). Per-page entry registry of
  open overlays; routes `turbo-overlay:close` window events to the
  matching overlay(s).
- **`overlay_controller.js`** — Stimulus controller on each
  `<dialog>` (`turbo-overlay`). Drives open/close, focus
  management, and dispatches the `turbo-overlay:shown` /
  `:before-close` / `:closed` events.
- **`hint.js`** — self-bootstrapping module. All listeners are
  document-level; it doesn't need a Stimulus controller because it
  never touches a specific element on connect.
- **`popover_position.js`** — anchored-positioning math with
  cross-axis auto-flip on viewport overflow.

## Helpers used by shipped layouts

Two view helpers exist primarily for use inside the gem's layouts
(useful if you eject layouts):

- `turbo_overlay_frame_id(type = nil)` — returns
  `turbo_overlay_<type>_<id>`, the per-overlay turbo-frame id.
- `overlay_response_wrapper(type, &block)` — wraps the layout body
  in the right primitive: a `<turbo-stream action="append">` on
  initial open, a bare `<turbo-frame>` on in-overlay re-render.
