# Reference

## Configuration

```ruby
# config/initializers/turbo_overlay.rb
TurboOverlay.configure do |config|
  config.stack_id = "turbo_overlay_stack"  # host-page stack container DOM id

  config.modal do |m|
    m.variant = :modal             # Rails request variant
    m.advance = false              # push history on open (URL advance)
  end

  config.drawer do |d|
    d.variant  = :drawer
    d.position = :right            # :left, :right, :top, :bottom
    d.advance  = false             # push history on open (URL advance)
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

Available on controllers (when the concern is included) and views.
On overlay requests `request.variant` is also set to `:modal`,
`:drawer`, `:popover`, or `:hint`, so `format.html.modal { }` blocks
in `respond_to` work as expected — see
[Branching in controllers](customization.md#branching-in-controllers).

| Helper                                  | Returns                                                                |
|-----------------------------------------|------------------------------------------------------------------------|
| `modal_request?` / `drawer_request?` / `popover_request?` / `hint_request?` | `true` if the current request targets that overlay type |
| `overlay_request?`                      | `true` if the current request targets *any* overlay                    |
| `turbo_overlay_layout`                  | Layout name for the current request. Call from a custom layout method to compose with your own logic. |
| `turbo_overlay_type`                    | `:modal`, `:drawer`, `:popover`, `:hint`, or `nil`                     |
| `turbo_overlay_id`                      | The overlay id for the current request (user-supplied or generated)    |
| `turbo_overlay_position`                | Per-link position override (drawer or popover), or `nil`               |
| `turbo_overlay_align`                   | Per-link popover cross-axis alignment, or `nil`                        |
| `turbo_overlay_offset`                  | Per-link popover pixel offset, or `nil`                                |
| `turbo_overlay_backdrop?`               | `false` only when the link opened with `backdrop: false`; else `true`  |
| `turbo_overlay_close?`                  | `false` only when the link opened with `close: false`; else `true`     |
| `turbo_overlay_keep_open_on_redirect?`  | `true` only when the link opened with `keep_overlay_open_on_redirect: true`; else `false` |
| `modal_link_to(name, path, overlay_id:, close:, advance:, keep_overlay_open_on_redirect:, hint:, hint_url:, show_delay:, hide_delay:)` | `link_to` that opens the target as a stacked modal |
| `drawer_link_to(name, path, overlay_id:, position:, backdrop:, close:, advance:, keep_overlay_open_on_redirect:, hint:, hint_url:, show_delay:, hide_delay:)` | stacked drawer |
| `popover_link_to(name, path, overlay_id:, position:, align:, offset:, close:, keep_overlay_open_on_redirect:, hint:, hint_url:, show_delay:, hide_delay:)` | anchored popover (no `advance:` — popovers never push history) |
| `hint_link_to(name, path, hint_url:, show_delay:, hide_delay:)` | plain `link_to` decorated with hint data attributes |
| `modal_dismiss_link_to(...)`            | dismiss link inside a modal                                            |
| `drawer_dismiss_link_to(...)`           | dismiss link inside a drawer                                           |
| `popover_dismiss_link_to(...)`          | dismiss link inside a popover                                          |
| `overlay_stack_tag`                     | emits the host-page stack container (drop in `application.html.erb`)   |
| `overlay_title(value, &block)`          | sets `content_for :overlay_title`                                      |
| `overlay_footer(value, &block)`         | sets `content_for :overlay_footer`                                     |
| `overlay_close(show = true)`            | toggle the chrome's default close button for this render               |
| `overlay_close?`                        | view-side predicate that folds in `<% overlay_close false %>` precedence |
| `turbo_stream.overlay(:close, scope:, type:, id:)` | turbo-stream action; closes top, all, or one overlay. `:hide` and `:dismiss` are accepted aliases for `:close`. See [stack-scoped variants](#turbo_stream-overlay-close-variants). |

## `turbo_stream.overlay(:close)` variants

```ruby
turbo_stream.overlay(:close)                              # top overlay
turbo_stream.overlay(:close, scope: :all)                 # every open overlay
turbo_stream.overlay(:close, scope: :all, type: :modal)   # all modals only
turbo_stream.overlay(:close, id: "edit_user_42")          # specific id
```

`:hide` and `:dismiss` are accepted aliases for `:close`. The `type:`
filter accepts `:modal`, `:drawer`, or `:popover` — hints don't
participate in server-driven close.

## JavaScript events

The gem dispatches custom events at key moments so apps can wire
autofocus, analytics, cleanup, etc. without monkey-patching the
controllers.

| Event | Target | Detail | When |
| --- | --- | --- | --- |
| `turbo-overlay:shown` | dialog (bubbles) | `{ id, type }` | Dialog is open and interactive. Fires once per open. |
| `turbo-overlay:before-close` | dialog (bubbles) | `{ id, type }` | Close just started; the dialog is still visible. Not cancellable. |
| `turbo-overlay:closed` | dialog (bubbles) | `{ id, type }` | Dialog has closed. Still in the DOM at dispatch time, so listeners can read its attributes. |
| `turbo-overlay:hint-shown` | document | `{ url }` | A hover hint just appeared (real content, not the pending placeholder). |
| `turbo-overlay:hint-ready` | document | `{ url, fragment }` | Hint content has been resolved for a URL. Fires whether or not the hint will actually be shown. |
| `turbo-overlay:close` | window | `{ scope, type, id }` | A server-issued `turbo_stream.overlay(:close, …)` just arrived. |

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

## JavaScript API

The gem's JS module exposes two functions. Both are available as
named exports from the package and as properties of a `window.TurboOverlay`
global (assigned when the module loads, before `register()` is called).

```js
import { register, visit } from "turbo_overlay"
// or, without a bundler:
//   window.TurboOverlay.visit(...)
```

### `TurboOverlay.register(application, options?)`

Registers the gem's two Stimulus controllers under their canonical
identifiers (`turbo-overlay-stack`, `turbo-overlay`). Importing the
package runs the page-level wiring (header injection, loading
placeholders, the `turbo_stream.overlay` action) — `register` only
handles the Stimulus pieces.

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `confirm` | boolean | `false` | Route `data-turbo-confirm` through the gem's themed overlay instead of `window.confirm`. Requires the confirm chrome partials copied by `turbo_overlay:install`. |

### `TurboOverlay.visit(url, options?)`

Opens an overlay from JavaScript — the programmatic counterpart to
`modal_link_to` / `drawer_link_to` / `popover_link_to`. Use for
non-anchor triggers (map markers, canvas hit-tests, custom elements).
For ordinary HTML links, prefer the Rails helpers.

```js
TurboOverlay.visit("/places/123")                                // modal (default)
TurboOverlay.visit("/cart",     { type: "drawer", advance: true })
TurboOverlay.visit("/preview/9", { type: "popover", anchor: el, position: "top" })
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `type` | `"modal" \| "drawer" \| "popover" \| "hint"` | `"modal"` | Overlay variant. |
| `id` | string | auto-generated | Reuse an existing overlay slot; re-issuing with the same id replaces the open overlay. |
| `position` | `"top" \| "bottom" \| "left" \| "right"` | `"bottom"` | Popover side. |
| `align` | `"start" \| "center" \| "end"` | `"start"` | Popover cross-axis alignment. |
| `offset` | number-string | `"4"` | Pixel gap between anchor and popover. |
| `backdrop` | boolean | `true` | Set `false` to render the modal/drawer without a backdrop. |
| `close` | boolean | `true` | Set `false` to suppress the chrome's default close button. |
| `keepOpenOnRedirect` | boolean | `false` | Keep the overlay open when a form submission inside it redirects. |
| `advance` | `boolean \| string` | unset | Push browser history. Modal/drawer only — silently dropped for popover/hint. |
| `anchor` | `Element` | — | **Required for `type: "popover"`.** Used for positioning and for the popover-trigger registry. |
| `frame` | string | `"_top"` | Target `data-turbo-frame`. Default breaks out of any enclosing frame so the overlay stacks. |

Throws `TypeError` if `url` is missing, `type` is unknown, or a popover
is opened without an `anchor`.

Behaviorally identical to clicking a `modal_link_to`/etc. trigger:
the same headers, the same loading placeholder, the same stream
response, the same lifecycle events. Internally implemented by
synthesizing a hidden `<a>` and clicking it, so every existing hook
(`turbo:before-fetch-request`, `turbo-overlay:shown`, etc.) fires
exactly as it would for a real link.
