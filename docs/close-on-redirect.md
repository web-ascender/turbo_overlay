# Close on redirect

When a form inside an overlay submits and Turbo follows a redirect,
the overlay closes by default. This page covers the full surface:
how the close fires, how to opt out, and the smooth-close behavior
that runs without configuration.

For the basic shape (implicit close, explicit
`turbo_stream.overlay(:close)`), start in the
[README](../README.md#close-the-overlay).

## Detection

A per-dialog `turbo:submit-end` listener runs after every form
submission inside the overlay. It closes when:

- The event target is a descendant `<form>` of the dialog.
- `fetchResponse.redirected === true` — Turbo's fetch followed a
  `Location:` header transparently.

Plain `2xx` responses don't trigger close. Validation failures
(`:unprocessable_entity`, `422`) don't redirect, so the form
re-renders in place inside the overlay. The decision is a pure
function exported as `shouldCloseOnRedirect` from
`app/javascript/turbo_overlay/submit_close.js`.

## Keep the overlay open on redirect

Wizard steps and inline edits that follow the POST-then-redirect
idiom opt out at one of two levels — finest-grained wins.

**Per-overlay** — every form inside this overlay survives its
redirects:

```erb
<%= modal_link_to "Start Wizard", new_wizard_path,
                  keep_overlay_open_on_redirect: true %>
```

Round-trips through an `X-Turbo-Overlay-Keep-Open` request header
to a `data-turbo-overlay-keep-open-on-redirect="true"` attribute on
the `<dialog>`. Available on `modal_link_to`, `drawer_link_to`, and
`popover_link_to`.

**Per-form** — this one form opts out, siblings still close:

```erb
<%= form_with(model: @step,
              data: { "turbo-overlay-keep-open-on-redirect" => true }) do |f| %>
```

## Smooth same-page redirects

When the redirect target is the same pathname as the URL the overlay
was opened from (the common edit-a-row-visible-in-the-list pattern),
the host page morphs in place behind the still-open overlay before
the close animation. No flash-of-stale-content, no app configuration.

```ruby
# /widgets renders a list. The overlay opens /widgets/42/edit. The
# successful update redirects back to /widgets — that pathname
# matches what was behind the overlay when it opened, so the gem
# fetches /widgets, morphs the host page in place, then animates
# close.
def update
  if @widget.update(widget_params)
    redirect_to widgets_path
  else
    render :edit, status: :unprocessable_entity
  end
end
```

Conditions:

- Modal or drawer only (popovers and hints don't participate; they
  never stamp an opener URL).
- Exactly one overlay open in the stack — stacked submits fall back
  to close-then-visit so a sibling overlay's URL entry isn't
  clobbered.
- Pathname matches the URL the overlay was opened from. Query string
  and hash differ freely; cross-origin redirects don't morph.

The opener URL is captured on `connect` and stamped as
`data-turbo-overlay-opener-url` on the dialog. A morph-attribute
hook preserves it through in-overlay form re-renders (so validation
failures don't reset the captured URL).

Morphing uses `window.Turbo.morphChildren` — Turbo 8's public
morph API — with a `beforeNodeMorphed` callback that excludes the
`overlay_stack_tag` container so the open dialog survives the morph.
`data-turbo-permanent` and `turbo:before-morph-*` events compose
normally; no separate Idiomorph dependency.

## Different-page redirects

Redirects to a different pathname follow the existing close-then-
visit path. The submit-end handler `await`s the close animation
before calling `Turbo.visit`, so the new page never paints behind a
still-closing overlay.

The same `keep_overlay_open_on_redirect` / per-form data attribute
opts out of both the same-page and different-page paths.

## Server-issued close

When the action wants to update other parts of the page in the same
response (flash messages, lists, etc.), use the explicit close
instead of a redirect:

```ruby
render turbo_stream: [
  turbo_stream.update("flash", partial: "shared/flash"),
  turbo_stream.overlay(:close)
]
```

Stack-scoped variants (close all, close by id, filter by type) are
documented in
[reference.md](reference.md#turbo_streamoverlayclose-variants).
