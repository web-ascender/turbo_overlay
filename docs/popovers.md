# Popovers

`popover_link_to` opens its target as a non-modal `<dialog>` anchored
to the clicked link.

```erb
<%= popover_link_to "Edit", edit_user_path(@user) %>
```

## Per-link options

```erb
<%= popover_link_to "Edit", edit_user_path(@user),
                    position: :top,    # :top, :bottom (default), :left, :right
                    align:    :center, # :start (default), :center, :end
                    offset:   8 %>     # pixels between trigger and dialog (default 4)
```

Popovers **auto-flip** across the cross axis when the preferred side
would overflow the viewport (e.g. `:bottom` becomes `:top` near the
bottom edge). Disable globally with `config.popover.auto_flip = false`.

## Dismissal

ESC, clicking outside the popover, or any explicit
`turbo_stream.overlay(:close, type: :popover)`. Because popovers are
non-modal, the page beneath stays scrollable and interactive — the
popover repositions itself as the anchor scrolls.

## Single-popover behavior

Opening a second popover automatically dismisses any other open
popover. A popover opened from inside a modal sits above the modal,
and a modal opened from inside a popover sits above the popover —
dismissing the upper overlay leaves the lower one in place.

## Links inside popovers

A plain `link_to` inside a popover navigates the whole page (and
closes the popover) instead of replacing the popover's contents.
Overlay link helpers (`modal_link_to`, `drawer_link_to`,
`popover_link_to`) keep their stacking behavior. Forms inside the
popover re-render in place on validation failure as usual.

## No default close button

Popovers don't render a "×" by default. Opt back in per-view with
`<% overlay_close true %>`, or globally by editing
`app/views/turbo_overlay/_popover.html.erb`.

## Drawer per-link options

`drawer_link_to` accepts two per-link kwargs that override the
configured defaults:

```erb
<%# Override the configured drawer side just for this link %>
<%= drawer_link_to "Filters", filters_path, position: :left %>

<%# Open without a backdrop — page stays scrollable and selectable.
    ESC still closes; click-outside is ignored (no backdrop). %>
<%= drawer_link_to "Inspector", inspect_path, backdrop: false %>
```

`backdrop: false` opens the drawer non-modally: no dimmed backdrop,
the page stays scrollable and selectable, click-outside is ignored
(no backdrop to click). Useful when the user needs to read or copy
from the host page while the drawer is open.

### Backdrop knobs side-by-side

| Setting                                             | Backdrop visible? | Click outside dismisses? | Page interactive? |
|-----------------------------------------------------|:-----------------:|:------------------------:|:-----------------:|
| (default)                                           | ✓                 | ✓                        | —                 |
| `data-turbo-overlay-backdrop-dismiss-value="false"` | ✓                 | —                        | —                 |
| `drawer_link_to ..., backdrop: false`               | —                 | — (no backdrop to click) | ✓                 |

### Non-modal drawers don't compose inside a modal

`backdrop: false` only works as expected when the drawer is opened
from the main page. Opening a non-modal drawer from inside another
open modal/drawer is **not supported** — HTML's inertness algorithm
blocks the page (and any non-top-layer dialog) from receiving input
while the parent modal is open, so the "non-modal" semantic doesn't
apply in that context. The drawer renders behind the parent and is
inert.

Popovers triggered from inside an open modal *do* work — the gem
promotes them to a modal under the hood (with a transparent
`::backdrop`) so they stack correctly.
