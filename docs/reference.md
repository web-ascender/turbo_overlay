# Reference

## Configuration

```ruby
# config/initializers/turbo_overlay.rb
TurboOverlay.configure do |config|
  config.stack_id = "turbo_overlay_stack"  # host-page stack container DOM id

  config.modal do |m|
    m.variant = :modal             # Rails request variant
  end

  config.drawer do |d|
    d.variant  = :drawer
    d.position = :right            # :left, :right, :top, :bottom
  end

  config.popover do |p|
    p.variant   = :popover
    p.position  = :bottom          # :top, :bottom, :left, :right
    p.align     = :start           # :start, :center, :end
    p.offset    = 4                # pixels between trigger and dialog
    p.auto_flip = true             # flip to opposite side on overflow
  end

  config.confirm do |cf|
    cf.style = :modal              # :modal (default) or :popover
  end

  config.hint do |h|
    h.show_delay_ms = 250          # hover must persist this long
    h.hide_delay_ms = 120          # grace window after mouseleave
  end
end
```

## Helpers

Available on controllers (when the concern is included) and views:

| Helper                                  | Returns                                                                |
|-----------------------------------------|------------------------------------------------------------------------|
| `modal_request?` / `drawer_request?` / `popover_request?` / `hint_request?` | `true` if the current request targets that overlay type |
| `overlay_request?`                      | `true` if the current request targets *any* overlay                    |
| `turbo_overlay_layout`                  | The layout name for the current request: `"turbo_overlay/modal"` etc. for overlay requests, `"turbo_rails/frame"` for plain turbo-frame requests, `nil` otherwise. Auto-installed via `layout -> { turbo_overlay_layout }`; call from a custom layout method to compose with your own logic |
| `overlay_prefetch_request?`             | `true` when the request is a Turbo hover prefetch (`X-Sec-Purpose: prefetch`) |
| `overlay_hintable_request?`             | `true` for prefetches and `:hint` variant fetches — used internally to decide whether to emit the `+hint` template |
| `turbo_overlay_type`                    | `:modal`, `:drawer`, `:popover`, `:hint`, or `nil`                     |
| `turbo_overlay_id`                      | The overlay id for the current request (user-supplied or generated)    |
| `turbo_overlay_position`                | Per-link position override (drawer or popover), or `nil`               |
| `turbo_overlay_align`                   | Per-link popover cross-axis alignment, or `nil`                        |
| `turbo_overlay_offset`                  | Per-link popover pixel offset, or `nil`                                |
| `turbo_overlay_backdrop?`               | `false` only when the link opened with `backdrop: false`; else `true`  |
| `turbo_overlay_close?`                  | `false` only when the link opened with `close: false`; else `true`     |
| `modal_link_to(name, path, overlay_id:, close:, hint:, hint_url:, show_delay:, hide_delay:)` | `link_to` that opens the target as a stacked modal |
| `drawer_link_to(name, path, overlay_id:, position:, backdrop:, close:, hint:, hint_url:, show_delay:, hide_delay:)` | stacked drawer |
| `popover_link_to(name, path, overlay_id:, position:, align:, offset:, close:, hint:, hint_url:, show_delay:, hide_delay:)` | anchored popover |
| `hint_link_to(name, path, hint_url:, show_delay:, hide_delay:)` | plain `link_to` decorated with hint data attributes (no overlay opening) |
| `modal_dismiss_link_to(...)`            | dismiss link inside a modal                                            |
| `drawer_dismiss_link_to(...)`           | dismiss link inside a drawer                                           |
| `popover_dismiss_link_to(...)`          | dismiss link inside a popover                                          |
| `overlay_stack_tag`                     | emits the host-page stack container (drop in `application.html.erb`)   |
| `overlay_title(value, &block)`          | sets `content_for :overlay_title`                                      |
| `overlay_footer(value, &block)`         | sets `content_for :overlay_footer`                                     |
| `overlay_close(show = true)`            | toggle the chrome's default close button for this render               |
| `overlay_close?`                        | view-side predicate that folds in `<% overlay_close false %>` precedence over the controller-side `turbo_overlay_close?` |
| `turbo_overlay_frame_id(type = nil)`    | `turbo_overlay_<type>_<id>` — the per-overlay turbo-frame id          |
| `overlay_response_wrapper(type, &block)` | wraps the layout body in the right primitive (turbo-stream append on initial open, turbo-frame on in-overlay re-render) — used by shipped overlay layouts |
| `turbo_stream.overlay(:close, scope:, type:, id:)` | turbo-stream action; closes top, all, or one overlay. `:hide` and `:dismiss` are accepted aliases for `:close`. |

## JavaScript events

The gem dispatches custom events at key moments so apps can wire
autofocus, analytics, cleanup, etc. without monkey-patching the
controllers.

| Event | Target | Detail | When |
| --- | --- | --- | --- |
| `turbo-overlay:shown` | dialog (bubbles) | `{ id, type }` | Controller wired, dialog is open and interactive. Fires once per open, after a placeholder morph or on direct open. |
| `turbo-overlay:before-close` | dialog (bubbles) | `{ id, type }` | Close just started; the dialog is still visible. Not cancellable. |
| `turbo-overlay:closed` | dialog (bubbles) | `{ id, type }` | Close animation done, `<dialog>` has closed, the wrapping frame is about to be removed. The dialog node is still in the DOM at dispatch time. |
| `turbo-overlay:hint-shown` | document | `{ url }` | A hover hint just appeared (real content, not the pending placeholder). |
| `turbo-overlay:hint-ready` | document | `{ url, fragment }` | The gem extracted hint content for a URL. Fires whether or not the hint will actually be shown. |
| `turbo-overlay:close` | window | `{ scope, type, id }` | Server-issued `turbo_stream.overlay(:close, …)` close command, or a teardown when a same-id overlay is being replaced. |

The three lifecycle events bubble from the dialog, so you can listen
at any level:

```js
// Autofocus the first input in any newly-opened overlay:
document.addEventListener("turbo-overlay:shown", (event) => {
  const input = event.target.querySelector("input:not([type=hidden]), textarea, select")
  if (input) input.focus()
})

// Track overlay opens by id:
document.addEventListener("turbo-overlay:shown", (event) => {
  analytics.track("overlay_opened", event.detail)
})
```

## Request lifecycle

A single host-page stack container (`<div id="turbo_overlay_stack">`)
receives appended overlays. Each opened overlay is wrapped in its own
`<turbo-frame id="turbo_overlay_<type>_<id>">` so forms inside it can
re-render in place via standard Turbo frame scoping.

When you click `<%= modal_link_to "Edit", edit_user_path(@user) %>`:

1. Turbo issues a `data-turbo-stream="true"` fetch. A small JS hook
   adds `X-Turbo-Overlay: modal` and (if you supplied `overlay_id:`)
   `X-Turbo-Overlay-Id` request headers.
2. The controller concern's `before_action` reads `X-Turbo-Overlay`,
   sets `request.variant = :modal`, and forces html template
   resolution.
3. Rails picks `edit.html+modal.erb` if it exists, else
   `edit.html.erb`.
4. The auto-installed `layout -> { turbo_overlay_layout }` proc
   returns `"turbo_overlay/modal"`. The modal layout wraps the view in
   `<turbo-stream action="append" target="turbo_overlay_stack">`
   whose template contains a
   `<turbo-frame id="turbo_overlay_modal_<id>">` wrapping the dialog.
5. The concern's `after_action` sets the response Content-Type to
   `text/vnd.turbo-stream.html; charset=utf-8` so Turbo processes the
   stream tag. (Hint requests are an exception — they're fetched via
   plain `fetch()` from the gem's JS, keep their `text/html` Content-Type,
   and the response is parsed via `DOMParser`.)
6. Turbo appends the new turbo-frame into the stack.
7. The per-dialog `turbo-overlay` Stimulus controller registers with
   the stack controller and opens the dialog.

When a form inside an overlay submits:

1. Turbo scopes the request to the enclosing turbo-frame
   (`turbo_overlay_modal_<id>`) and includes that frame id in the
   `Turbo-Frame` header.
2. On success the controller responds with a turbo-stream containing
   `turbo_stream.overlay(:close)` (and any host-page updates).
3. On validation failure (`render :new, status: :unprocessable_entity`),
   the layout detects the frame request and wraps the response in
   `<turbo-frame id="turbo_overlay_modal_<id>">` — Turbo replaces
   the frame contents in place, the overlay stays open, and the
   per-dialog Stimulus controller short-circuits its open path on
   reconnect so the dialog isn't double-opened.
